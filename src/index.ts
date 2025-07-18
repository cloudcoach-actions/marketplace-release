import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import archiver from 'archiver';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { Builder, parseStringPromise } from 'xml2js';
import {
	FeatureBundle,
	IndexData,
	MarketplaceConfig,
	Package,
} from './models/marketplace.models';
import { FolderStructureBuilder } from './utils/folder-parser';

// Action inputs
const API_VERSION = core.getInput('api-version');
const GITHUB_TOKEN: string = core.getInput('github-token', { required: true });
const RELEASE_VERSION: string = core.getInput('release-version', {
	required: true,
});

// Environment variables
const GITHUB_WORKSPACE: string = process.env.GITHUB_WORKSPACE!;

// Constants
const INDEX_FILE: string = path.join(GITHUB_WORKSPACE, 'index.json');
const MARKETPLACE_FILE: string = path.join(
	GITHUB_WORKSPACE,
	'info.json',
);
const SFDX_PROJECT_JSON_FILE: string = path.join(
	GITHUB_WORKSPACE,
	'sfdx-project.json',
);
const DIST_FOLDER: string = path.join(GITHUB_WORKSPACE, 'dist');
const PACKAGE_FILE_NAME: string = 'sfpackage.json';
const README_FILE_NAME: string = 'README.md';
const IGNORED_DIRECTORY_CONTENT = [
	'dist',
	'.DS_Store',
	'package.xml',
	'destructiveChanges.xml',
	'bundle.json',
];

const errors: string[] = [];
const octokit = github.getOctokit(GITHUB_TOKEN);
let marketplaceConfig: MarketplaceConfig;

/**
 * Read all files from the given folders and their subfolders using fs.readdir's
 * recursive option.
 *
 * @param folderPaths Array of folder paths to read
 * @returns A promise that resolves to an array of file paths
 */
const getFolderStructure = async (folderPaths: string[]) => {
	let allFilePaths: string[] = [];

	for (const folder of folderPaths) {
		try {
			// Read all files and folders recursively in the folder
			const files = await fsPromises.readdir(folder, {
				withFileTypes: false,
				recursive: true,
			});

			// Convert relative paths to absolute paths
			const filePaths = files.map(file => path.resolve(folder, file));
			allFilePaths = allFilePaths.concat(filePaths);
		} catch (ex) {
			captureError(ex, `Error reading folder ${folder}`);
		}
	}

	return allFilePaths;
};

/**
 * Takes a flat list of folder paths and groups them by the top-level
 * folder name.
 *
 * @example
 * {
 *   "classes": ["path/to/folder1/file1", "path/to/folder1/file2"],
 *   "objects": ["path/to/folder1/file1", "path/to/folder1/file2"],
 *   "pages": ["path/to/folder2/file1", "path/to/folder2/file2"]
 * }
 * @param folderPaths Array of folder paths to group
 */
const getFolderStructureGroupedByObjectType = async (
	folderPaths: string[],
): Promise<Record<string, string[]>> => {
	const allFilePaths = await getFolderStructure(folderPaths);
	const groupedFolders = {};

	allFilePaths.forEach(filePath => {
		const relativePath = path.relative(folderPaths[0], filePath);
		const topLevelFolder = relativePath.split(path.sep)[0];

		if (!groupedFolders[topLevelFolder]) {
			groupedFolders[topLevelFolder] = [];
		}

		groupedFolders[topLevelFolder].push(filePath);
	});

	return groupedFolders;
};

/**
 * Create a zip file of the contents of a specified folder
 * excluding the 'dist' folder.
 *
 * @param sourceDir The path to the folder to zip
 * @param outPath The path to the output zip file
 */
const zipFolder = async (sourceDir: string, outPath: string): Promise<void> => {
	const output = fs.createWriteStream(outPath);
	const archive = archiver('zip', {
		zlib: { level: 9 }, // Sets the compression level
	});

	return new Promise<void>((resolve, reject) => {
		output.on('close', () => {
			console.log(
				`Archive created successfully, total bytes: ${archive.pointer()}`,
			);
			resolve();
		});

		archive.on('error', err => {
			reject(err);
		});

		archive.pipe(output);

		// Append files from the source directory, excluding the 'dist' folder
		archive.glob('**/*', {
			cwd: sourceDir,
			ignore: ['dist/**', 'bundle.json'],
		});

		archive.finalize();
	});
};

/**
 * Gets all subdirectories under a specified directory.
 *
 * @param directory The source directory to get subdirectories from.
 */
const getSubdirectories = async (directory: string): Promise<string[]> => {
	const entries = await fsPromises.readdir(directory, { withFileTypes: true });
	return entries
		.filter(
			entry =>
				entry.isDirectory() && !IGNORED_DIRECTORY_CONTENT.includes(entry.name),
		)
		.map(entry => path.join(directory, entry.name));
};

/**
 * Gets all files in a specified directory.
 *
 * @param directory The source directory to get files from.
 */
const getFilesInDirectory = async (directory: string): Promise<string[]> => {
	const entries = await fsPromises.readdir(directory, { withFileTypes: true });
	return entries
		.filter(entry => entry.isFile())
		.map(entry => path.join(directory, entry.name));
};

/**
 * Copies the content from the dependency folders to the feature folder so that
 * they can be compiled together.
 */
const prepDependencies = async (
	featurePath: string,
	dependencies: string[],
) => {
	const featurePathSegments = featurePath.split(path.sep);
	const featureParentPath = featurePathSegments.slice(0, -1).join(path.sep);

	for (const dependency of dependencies) {
		const dependencyPath = path.join(featureParentPath, dependency);
		const dependencySubdirectories = await getSubdirectories(dependencyPath);

		for (const subdirectory of dependencySubdirectories) {
			const subdirectoryName = path.basename(subdirectory);
			const targetPath = path.join(featurePath, subdirectoryName);

			// Ensure the target directory exists
			await fsPromises.mkdir(targetPath, { recursive: true });

			const files = await getFilesInDirectory(subdirectory);

			for (const file of files) {
				const fileName = path.basename(file);
				const targetFilePath = path.join(targetPath, fileName);

				try {
					// Check if the target file already exists
					if (await fileExists(targetFilePath)) {
						core.setFailed(`File already exists: ${targetFilePath}`);
					} else {
						await exec.exec('cp', [file, targetFilePath]);
						core.info(`Copied ${file} to ${targetFilePath}`);
					}
				} catch (ex) {
					captureError(ex, `Error copying ${file} to ${targetFilePath}`);
				}
			}
		}
	}
};

/**
 * Creates Salesforce package metadata for a feature install.
 *
 * @param featurePath The path to the feature within the repository.
 * @param featureInfo The feature info object.
 * @returns True if the operation was successful, false otherwise.
 */
const createSalesforcePackageMetadata = async (
	featurePath: string,
	fileSuffix?: string,
): Promise<boolean> => {
	core.info(`Creating Salesforce package metadata for ${featurePath}`);
	const featureName = path.basename(featurePath);

	const outputDir = path.join(
		DIST_FOLDER,
		featureName,
		fileSuffix ? `install${fileSuffix}` : 'install',
	);

	/* if (featureInfo.dependencies && featureInfo.dependencies.length) {
		await prepDependencies(featurePath, featureInfo.dependencies);
	} */

	const sfdxProjectJson = {
		packageDirectories: [
			{ path: path.relative(GITHUB_WORKSPACE, featurePath), default: true },
		],
		sfdcLoginUrl: 'https://login.salesforce.com',
		sourceApiVersion: API_VERSION,
	};
	core.info(JSON.stringify(sfdxProjectJson));

	// Write the sfdx-project.json to the root folder so that it can be
	// recognized by the Salesforce CLI
	await fsPromises.writeFile(
		SFDX_PROJECT_JSON_FILE,
		JSON.stringify(sfdxProjectJson),
	);

	try {
		// Use the Salesforce CLI to generate the package.xml and source content
		await exec.exec('sf', ['project', 'convert', 'source', '-d', outputDir]);
		core.info(`Install artifacts for ${featureName}, created successfully`);

		// Create the uninstall package metadata which uses the created
		// install package.xml
		await createUninstallPackageMetadata(featurePath, fileSuffix);

		// Discard local changes in the feature folder to ensure that if any files
		// were copied in as dependencies, they are removed before any
		// following iterations
		await discardLocalChanges(featurePath);

		return true;
	} catch (ex) {
		captureError(ex, `Error running 'sf project convert source' command`);
		return false;
	}
};

/**
 * Creates Salesforce package metadata for a feature uninstall. This method is
 * dependent on the output created from the createSalesforcePackageMetadata()
 * method.
 *
 * @param featurePath The path to the feature within the repository.
 */
const createUninstallPackageMetadata = async (
	featurePath: string,
	fileSuffix?: string,
): Promise<void> => {
	const featureName = path.basename(featurePath);
	const folderName = fileSuffix ? `uninstall${fileSuffix}` : 'uninstall';

	// Ensure the uninstall dist folder exists
	const uninstallDistPath = path.join(DIST_FOLDER, featureName, folderName);
	await fsPromises.mkdir(uninstallDistPath, { recursive: true });

	// Read the package.xml content from the install dist folder
	const packageXmlPath = path.join(
		DIST_FOLDER,
		featureName,
		fileSuffix ? `install${fileSuffix}/package.xml` : 'install/package.xml',
	);
	core.info('packageXmlPath: ' + packageXmlPath);
	const packageXmlContent = await fsPromises.readFile(packageXmlPath, 'utf8');

	// Parse the XML content
	const parsedPackageXml = await parseStringPromise(packageXmlContent);

	// Extract and remove the <types> nodes
	const typesNodes = parsedPackageXml.Package.types;
	delete parsedPackageXml.Package.types;

	// Create a new XML content with the removed <types> nodes
	const builder = new Builder();
	const destructiveChangesXml = builder
		.buildObject({ Package: { types: typesNodes } })
		.replace(
			'<Package>',
			'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		)
		.replace(' standalone="yes"', '');

	// Create updated package.xml content with the removed <types> nodes
	const updatedPackageXml = builder
		.buildObject(parsedPackageXml)
		.replace(
			'<Package>',
			'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		)
		.replace(' standalone="yes"', '');

	// Define the new file paths
	const updatedPackageXmlPath = path.join(
		DIST_FOLDER,
		featureName,
		`${folderName}/package.xml`,
	);
	const destructiveChangesXmlPath = path.join(
		DIST_FOLDER,
		featureName,
		`${folderName}/destructiveChanges.xml`,
	);

	// Write the modified package.xml content without <types> nodes
	await fsPromises.writeFile(updatedPackageXmlPath, updatedPackageXml);

	// Write the destructiveChanges.xml content with only <types> nodes
	await fsPromises.writeFile(destructiveChangesXmlPath, destructiveChangesXml);

	core.info(`Uninstall artifacts for ${featureName}, created successfully`);
};

/**
 * Checks if there are any pending changes in the repository.
 */
const hasPendingChanges = async (): Promise<boolean> => {
	let hasChanges = false;
	let output = '';

	const options = {
		listeners: {
			stdout: (data: Buffer) => {
				output += data.toString();
			},
		},
	};

	try {
		await exec.exec('git', ['status', '--porcelain'], options);
		hasChanges = output.trim().length > 0;
	} catch (ex) {
		captureError(ex, 'Error checking for pending changes');
	}

	return hasChanges;
};

/**
 * Helper function to discard local changes in a specific folder
 */
const discardLocalChanges = async (folderPath: string) => {
	try {
		await exec.exec('git', ['restore', '--staged', '--worktree', folderPath]);
		core.info(`Discarded local changes in folder: ${folderPath}`);
	} catch (error) {
		core.error(`Failed to discard local changes in folder: ${folderPath}`);
		throw error;
	}
};

/**
 * Uses the GitHub cli to discard changes to the temp files created during
 * the action.
 */
const discardTempFileChanges = async () => {
	try {
		await exec.exec('git', ['restore', '.']);
	} catch (ex) {
		captureError(ex, 'Error discarding temp file changes');
	}
};

/**
 * Capture an error message and add it to the errors array.
 *
 * @param ex The exception to capture.
 * @param detailedPrefix A specific prefix to add to the error message.
 */
const captureError = (ex: unknown, detailedPrefix?: string) => {
	const errMsg = ex instanceof Error ? ex.message : 'Unknown error';
	errors.push(
		detailedPrefix ? `${detailedPrefix}: ${errMsg}` : `Error: ${errMsg}`,
	);
};

/**
 * Creates install and uninstall zip files for a feature.
 *
 * @param featurePath The path to the feature within the repository.
 */
const createZipFiles = async (
	featurePath: string,
	withDeps = false,
): Promise<{
	installZipPath: string;
	uninstallZipPath: string;
	installWithDepsZipPath?: string;
	uninstallWithDepsZipPath?: string;
}> => {
	const featureName = path.basename(featurePath);
	const distPath = path.join(DIST_FOLDER, featureName);

	const installZipPath = path.join(distPath, `${featureName}-install.zip`);
	const uninstallZipPath = path.join(distPath, `${featureName}-uninstall.zip`);

	// Zip the contents of the install and uninstall folders and save
	// to the dist folder
	await zipFolder(path.join(distPath, 'install'), installZipPath);
	await zipFolder(path.join(distPath, 'uninstall'), uninstallZipPath);

	if (withDeps) {
		const installWithDepsZipPath = path.join(
			distPath,
			`${featureName}-install-with-deps.zip`,
		);
		const uninstallWithDepsZipPath = path.join(
			distPath,
			`${featureName}-uninstall-with-deps.zip`,
		);
		await zipFolder(
			path.join(distPath, 'install-with-deps'),
			installWithDepsZipPath,
		);
		await zipFolder(
			path.join(distPath, 'uninstall-with-deps'),
			uninstallWithDepsZipPath,
		);
		return {
			installZipPath,
			uninstallZipPath,
			installWithDepsZipPath,
			uninstallWithDepsZipPath,
		};
	}

	return { installZipPath, uninstallZipPath };
};

/**
 * Checks if a file exists at the specified path.
 *
 * @param filePath The file path to check.
 */
const fileExists = async (filePath: string): Promise<boolean> =>
	fsPromises
		.access(filePath, fs.constants.F_OK)
		.then(() => true)
		.catch(() => false);

/**
 * Helper function to read feature info from a file (e.g., bundle.json)
 */
const readBundleInfo = async (featurePath: string): Promise<FeatureBundle> => {
	const infoFilePath = path.join(featurePath, 'bundle.json');
	const infoContent = await fsPromises.readFile(infoFilePath, 'utf8');
	const bundle = JSON.parse(infoContent);

	const readmePath = await findFileCaseInsensitive(
		featurePath,
		README_FILE_NAME,
	);
	if (readmePath) {
		try {
			bundle.documentation = await readFile(readmePath);
		} catch (ex) {
			captureError(ex, `Error reading README.md file ${readmePath}`);
		}
	}

	return bundle;
};

/**
 * Helper function to read data within package json files.
 */
const readPackageJson = async (packageFilePath: string): Promise<Package[]> => {
	const packageContent = await fsPromises.readFile(packageFilePath, 'utf8');
	const parsedContent = JSON.parse(packageContent);

	if (Array.isArray(parsedContent)) {
		return parsedContent as Package[];
	} else {
		return [parsedContent as Package];
	}
};

/**
 * Reads the contents of a file at a specified path.
 *
 * @param filePath The path to the file.
 */
const readFile = async (filePath: string): Promise<string> => {
	const content = await fsPromises.readFile(filePath, 'utf8');
	return content;
};

/**
 * Uploads a file as a GitHub release asset.
 *
 * @param releaseId The ID of the release to attach the asset to.
 * @param assetPath The path to the asset file to upload.
 * @param contentType The content type of the asset (e.g. application/zip).
 */
const uploadReleaseAsset = async (
	releaseId: number,
	assetPath: string,
	contentType: string,
) => {
	const absolutePath = path.resolve(assetPath);
	const fileName = path.basename(absolutePath);
	const fileStat = await fsPromises.stat(absolutePath);
	const fileContent = await fsPromises.readFile(absolutePath);

	// Note: If the content length is not specified when uploading a zip as a
	// release asset, the file will be corrupted.
	core.info(`Attaching file: ${fileName}`);
	await octokit.rest.repos.uploadReleaseAsset({
		owner: github.context.repo.owner,
		repo: github.context.repo.repo,
		release_id: releaseId,
		name: fileName,
		data: fileContent as any,
		headers: {
			'content-type': contentType,
			'content-length': fileStat.size,
		},
	});
};

/**
 * Helper function to find a file with a case-insensitive name check.
 *
 * @param directory The directory to search in.
 * @param fileName The name of the file to find.
 * @returns The path to the file if found, otherwise null.
 */
const findFileCaseInsensitive = async (
	directory: string,
	fileName: string,
): Promise<string | null> => {
	const files = await fsPromises.readdir(directory);
	const lowerCaseFileName = fileName.toLowerCase();
	const foundFile = files.find(
		file => file.toLowerCase() === lowerCaseFileName,
	);
	return foundFile ? path.join(directory, foundFile) : null;
};

/**
 * Reads contents of package folders recursively and returns an array of
 * data extracted from the package.json files. Additionally, if a README.md
 * file is present in the package folder, the contents are added to the
 * returned value.
 *
 * @param packageDir The path to the package directory.
 */
const getPackageData = async (packageDir): Promise<Package[]> => {
	const packages = await fsPromises.readdir(packageDir, {
		withFileTypes: true,
	});
	let results: Package[] = [];

	for (const entry of packages) {
		const entryPath = path.join(packageDir, entry.name);
		if (entry.isDirectory()) {
			const subResults = await getPackageData(entryPath);
			results = results.concat(subResults);
		} else if (entry.isFile()) {
			if (entry.name === PACKAGE_FILE_NAME) {
				const packages = await readPackageJson(entryPath);
				const readmePath = await findFileCaseInsensitive(
					packageDir,
					README_FILE_NAME,
				);
				if (readmePath) {
					try {
						const documentation = await readFile(readmePath);
						packages.forEach(pkg => {
							pkg.documentation = documentation;
						});
					} catch (ex) {
						captureError(ex, `Error reading README.md file ${readmePath}`);
					}
				}
				results.push(...packages);
			}
		}
	}

	return results;
};

/**
 * Loads the marketplace configuration from the root of the repository. This
 * provides the paths to required directories and files.
 *
 * @param marketplaceFile The path to the marketplace.json file.
 */
const loadMarketplaceConfig = async (
	marketplaceFile: string,
): Promise<void> => {
	try {
		const content = await fsPromises.readFile(marketplaceFile, 'utf8');
		marketplaceConfig = JSON.parse(content) as MarketplaceConfig;
		marketplaceConfig.paths.bundles = path.join(
			GITHUB_WORKSPACE,
			marketplaceConfig.paths.bundles,
		);
		marketplaceConfig.paths.packages = path.join(
			GITHUB_WORKSPACE,
			marketplaceConfig.paths.packages,
		);
		core.info(JSON.stringify(marketplaceConfig));
		core.info('Marketplace configuration loaded successfully.');
	} catch (error) {
		core.setFailed(`Failed to load marketplace configuration: ${error}`);
	}
};

/**
 * Processes a specified content folder and creates a GitHub release containing
 * packaged install and uninstall feature zip files as release assets.
 *
 * @param indexFile The path to the index.json file to create.
 */
const run = async (indexFile: string): Promise<void> => {
	// Get a list of each of the feature folders
	const features = await fsPromises.readdir(marketplaceConfig.paths.bundles);
	core.info('Features: ' + JSON.stringify(features));

	// Get a list of each of the packages
	const packages = await getPackageData(marketplaceConfig.paths.packages);
	core.info('Packages: ' + JSON.stringify(packages));

	// Create an object to store the index data as we iterate through each feature
	const info: IndexData = {
		bundles: [],
		packages: [],
	};
	// Properties to be copied from the marketplace config
	[ 'title', 'description' ].forEach(key => {
		if (marketplaceConfig[key]) {
			info[key] = marketplaceConfig[key];
		}
	});

	// Keep track of created zip file paths for later use
	const zipPaths: string[] = [];

	let folderStructureBuilder: FolderStructureBuilder;

	for (const folder of features) {
		const featurePath = path.join(marketplaceConfig.paths.bundles, folder);
		// Read the existing bundle.json file from the feature folder. We'll need
		// this to build the index.json
		const featureInfo = await readBundleInfo(featurePath);

		const hasDependencies =
			!!featureInfo.dependencies && !!featureInfo.dependencies.length;

		const filePathsByObjectType = await getFolderStructureGroupedByObjectType([
			featurePath,
		]);
		folderStructureBuilder = new FolderStructureBuilder(
			filePathsByObjectType,
			IGNORED_DIRECTORY_CONTENT,
		);

		await createSalesforcePackageMetadata(featurePath);

		if (hasDependencies) {
			await prepDependencies(featurePath, featureInfo.dependencies as string[]);
			await createSalesforcePackageMetadata(featurePath, '-with-deps');
		}

		const {
			installZipPath,
			uninstallZipPath,
			installWithDepsZipPath,
			uninstallWithDepsZipPath,
		} = await createZipFiles(featurePath, hasDependencies);

		zipPaths.push(installZipPath);
		zipPaths.push(uninstallZipPath);

		if (installWithDepsZipPath) {
			zipPaths.push(installWithDepsZipPath);
		}
		if (uninstallWithDepsZipPath) {
			zipPaths.push(uninstallWithDepsZipPath);
		}

		info.bundles.push({
			id: folder,
			name: featureInfo.name,
			description: featureInfo.description,
			version: RELEASE_VERSION,
			files: folderStructureBuilder
				.build()
				.map(file => path.relative(featurePath, file)),
			documentation: featureInfo.documentation || '',
			iconUrl: featureInfo.iconUrl,
			dependencies: featureInfo.dependencies || [],
			packageDependencies: featureInfo.packageDependencies || [],
			availability: featureInfo.availability || 'public',
			tags: featureInfo.tags || [],
		});
	}

	for (const pkg of packages) {
		core.info(JSON.stringify(pkg));
		info.packages.push(pkg);
	}

	core.info('index.json: ' + JSON.stringify(info, null, 2));

	const response = await octokit.rest.repos.createRelease({
		...github.context.repo,
		tag_name: RELEASE_VERSION,
		name: RELEASE_VERSION,
		body: `Automated release for version ${RELEASE_VERSION}`,
	});

	const releaseId = response.data.id;
	const releaseUrl = response.data.html_url;
	core.info(`Release created: ${releaseUrl}`);
	core.info(`Release ID: ${releaseId}`);

	for (const zipPath of zipPaths) {
		await uploadReleaseAsset(releaseId, zipPath, 'application/zip');
	}

	// Write the updated index.json file
	await fsPromises.writeFile(indexFile, JSON.stringify(info));

	// Upload the index.json file as a release asset
	await uploadReleaseAsset(releaseId, indexFile, 'application/json');

	const hasChanges = await hasPendingChanges();
	if (hasChanges) {
		// Discard any temporary files created during the action
		await discardTempFileChanges();
	} else {
		core.info('No changes to commit');
	}
};

/**
 * Main entry point for the action.
 */
(async () => {
	await loadMarketplaceConfig(MARKETPLACE_FILE);
	await run(INDEX_FILE);
	if (errors.length) {
		core.setFailed(errors.join('\n'));
	}
})();
