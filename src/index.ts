import * as archiver from 'archiver';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { IndexData } from './models/marketplace.models';

const contentDir = path.join(__dirname, 'content');
const indexFile = path.join(__dirname, 'index.json');

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

const run = async (contentDir: string, indexFile: string): Promise<void> => {
	// Get a list of each of the child folders under features
	const features = await fsPromises.readdir(contentDir);

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
		console.log('info', info);

		// Ensure the dist folder exists
		const distPath = path.join(featurePath, 'dist');
		await fsPromises.mkdir(distPath, { recursive: true });

		await zipFolder(
			featurePath,
			path.join(featurePath, 'dist', `${folder}.zip`),
		);
	}

	await fsPromises.writeFile(indexFile, JSON.stringify(info, null, 2));
};

(async () => {
	await run(contentDir, indexFile);
})();
