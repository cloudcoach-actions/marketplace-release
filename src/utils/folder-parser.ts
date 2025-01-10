import * as path from 'path';

export interface FolderParserStrategy {
	parseFiles(filePaths: string[], ignoredFolderContent?: string[]): string[];
}

/**
 * Default folder parser which filters out directories and metadata xml files.
 */
export class DefaultFolderParserStrategy implements FolderParserStrategy {
	private readonly _filenameWithExtensionRegex: RegExp = /\.[^\/]+$/;

	parseFiles(filePaths: string[], ignoredFolderContent = []): string[] {
		const filteredPaths = filePaths.filter(filePath => {
			const fileName = path.basename(filePath);
			return (
				this._filenameWithExtensionRegex.test(fileName) &&
				!ignoredFolderContent.some(ignored => filePath.includes(ignored)) &&
				!fileName.endsWith('-meta.xml')
			);
		});

		return filteredPaths;
	}
}

/**
 * Custom folder parser for Salesforce objects which filters out everything
 * except for the object folder itself.
 */
export class ObjectsFolderParserStrategy implements FolderParserStrategy {
	parseFiles(filePaths: string[]): string[] {
		const uniqueObjectPaths = this._getUniqueObjectPaths(filePaths);
		return uniqueObjectPaths;
	}

	private _getUniqueObjectPaths = (paths: string[]): string[] => {
		const featureNames = new Set<string>();

		paths.forEach(filePath => {
			const match = filePath.match(/\/objects\/([^\/]+)/);
			if (match) {
				featureNames.add(match[1]);
			}
		});

		return paths.filter(filePath => {
			return Array.from(featureNames).some(featureName =>
				filePath.endsWith(`/objects/${featureName}`),
			);
		});
	};
}

/**
 * Contains a collection of custom folder parsers mapped by Salesforce
 * metadata types.
 */
export const CustomFolderParserStrategies: Record<
	string,
	FolderParserStrategy
> = {
	['objects']: new ObjectsFolderParserStrategy(),
};

/**
 * Provides methods for parsing file paths for Marketplace Features.
 */
export class FolderStructureBuilder {
	constructor(
		private readonly _filePathsByObjectType: Record<string, string[]>,
		private readonly _ignoredFolderContent?: string[],
	) {}

	/**
	 * Builds a parsed list of file paths for all Salesforce metadata types in the
	 * specified source.
	 *
	 * @returns A flat list of file paths for all Salesforce metadata types.
	 */
	build(): string[] {
		return Object.keys(this._filePathsByObjectType)
			.map(key => {
				const folderParser =
					CustomFolderParserStrategies[key] ||
					new DefaultFolderParserStrategy();
				return folderParser.parseFiles(
					this._filePathsByObjectType[key],
					this._ignoredFolderContent,
				);
			})
			.flat();
	}
}
