import * as core from '@actions/core';
import * as archiver from 'archiver';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { Builder } from 'xml2js';
import {
	IndexData,
	metadataTypeFolderMappings,
	SalesforcePackageXmlType,
} from './models/marketplace.models';

const contentDir = path.join(__dirname, 'content');
const indexFile = path.join(__dirname, 'index.json');
const gitHubWorkspace = process.env.GITHUB_WORKSPACE;

const ignoredFolders: string[] = ['dist'];
const ignoredFileNames: string[] = ['.DS_Store'];
const errors: string[] = [];

/**
 * Read all files from the given folders and their subfolders using fs.readdir's
 * recursive option.
 *
 * @param folderPaths - Array of folder paths to read
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
		} catch (error) {
			console.error(`Error reading folder: ${folder}`, error);
		}
	}

	return allFilePaths;
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
			ignore: ['dist/**'],
		});

		archive.finalize();
	});
};

const getSubdirectories = async (directory: string): Promise<string[]> => {
	const entries = await fsPromises.readdir(directory, { withFileTypes: true });
	return entries
		.filter(
			entry => entry.isDirectory() && !ignoredFolders.includes(entry.name),
		)
		.map(entry => path.join(directory, entry.name));
};

const getFiles = async (directory: string): Promise<string[]> => {
	const entries = await fsPromises.readdir(directory, { withFileTypes: true });
	return entries
		.filter(
			entry => !entry.isDirectory() && !ignoredFileNames.includes(entry.name),
		)
		.map(entry => path.join(directory, entry.name));
};

const createPackageXmlContent = (
	types: SalesforcePackageXmlType,
	version: string,
) => {
	let xml: string = '';
	try {
		const builder = new Builder();
		const mappedTypes: Array<{ members: string[]; name: string }> = [];
		const packObj = {
			Package: {
				types: mappedTypes,
				version,
			},
		};

		// Append new nodes to the Package object
		Object.entries(types).forEach(([name, members]) => {
			mappedTypes.push({
				members,
				name,
			});
		});

		xml = builder
			.buildObject(packObj)
			.replace(
				'<Package>',
				'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
			)
			.replace(' standalone="yes"', '');
	} catch (ex) {
		const errMsg = ex instanceof Error ? ex.message : 'Unknown error';
		errors.push(`Error creating package.xml: ${errMsg}`);
	}

	return xml;
};

const createPackageXml = async (featurePath: string): Promise<string> => {
	const folders = await getSubdirectories(featurePath);

	const types: SalesforcePackageXmlType = {};
	for (const folder of folders) {
		const baseName = path.basename(folder);
		if (metadataTypeFolderMappings[baseName]) {
			// Read files and folders (hence using 'entries' convention)
			const entries = await fsPromises.readdir(folder, { withFileTypes: true });
			types[metadataTypeFolderMappings[baseName]] = entries.map(
				entry => path.parse(entry.name).name,
			);
		}
	}

	return Promise.resolve(createPackageXmlContent(types, '62.0'));
};

const run = async (contentDir: string, indexFile: string): Promise<void> => {
	// Get a list of each of the child folders under features
	const features = await fsPromises.readdir(contentDir);

	// Create an object to store the index data as we iterate through each feature
	const info: IndexData = {
		features: [],
	};

	// features.forEach(async folder => {
	for (const folder of features) {
		const featurePath = path.join(contentDir, folder);
		// Read the existing info.json file. We'll need to update this with the files
		const featureInfo = await fsPromises.readFile(
			path.join(featurePath, 'info.json'),
			'utf8',
		);
		const parsed = JSON.parse(featureInfo);
		const files = await getFolderStructure([featurePath]);

		info.features.push({
			id: parsed.id,
			name: folder,
			label: parsed.label,
			description: parsed.description,
			version: parsed.version,
			files: files.map(file => path.relative(featurePath, file)),
		});

		// Create the package.xml file
		const packageXml = await createPackageXml(featurePath);
		const packageXmlPath = path.join(featurePath, 'package.xml');
		await fsPromises.writeFile(packageXmlPath, packageXml);

		// Ensure the dist folder exists
		const distPath = path.join(featurePath, 'dist');
		await fsPromises.mkdir(distPath, { recursive: true });

		// Zip the contents of the feature folder (including package.xml) and save
		// it to the dist folder
		await zipFolder(
			featurePath,
			path.join(featurePath, 'dist', `${folder}.zip`),
		);
	}

	// Write the updated index.json file
	await fsPromises.writeFile(indexFile, JSON.stringify(info, null, 2));
};

(async () => {
	core.info('contentDir: ' + contentDir);
	core.info('indexFile: ' + indexFile);
	core.info('gitHubWorkspace: ' + gitHubWorkspace);
	await run(contentDir, indexFile);
	if (errors.length) {
		core.setFailed(errors.join('\n'));
	}
})();
