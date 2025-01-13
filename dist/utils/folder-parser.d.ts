export interface FolderParserStrategy {
    parseFiles(filePaths: string[], ignoredFolderContent?: string[]): string[];
}
/**
 * Default folder parser which filters out directories and metadata xml files.
 */
export declare class DefaultFolderParserStrategy implements FolderParserStrategy {
    private readonly _filenameWithExtensionRegex;
    parseFiles(filePaths: string[], ignoredFolderContent?: never[]): string[];
}
/**
 * Custom folder parser for Salesforce objects which filters out everything
 * except for the object folder itself.
 */
export declare class ObjectsFolderParserStrategy implements FolderParserStrategy {
    parseFiles(filePaths: string[]): string[];
    private _getUniqueObjectPaths;
}
/**
 * Contains a collection of custom folder parsers mapped by Salesforce
 * metadata types.
 */
export declare const CustomFolderParserStrategies: Record<string, FolderParserStrategy>;
/**
 * Provides methods for parsing file paths for Marketplace Features.
 */
export declare class FolderStructureBuilder {
    private readonly _filePathsByObjectType;
    private readonly _ignoredFolderContent?;
    constructor(_filePathsByObjectType: Record<string, string[]>, _ignoredFolderContent?: string[] | undefined);
    /**
     * Builds a parsed list of file paths for all Salesforce metadata types in the
     * specified source.
     *
     * @returns A flat list of file paths for all Salesforce metadata types.
     */
    build(): string[];
}
