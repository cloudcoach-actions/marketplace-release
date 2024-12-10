export interface FileMetadata {
    path: string;
    type?: string;
}
export interface Feature {
    id: string;
    name: string;
    label: string;
    description: string;
    version: string;
    files: string[];
}
export interface IndexData {
    features: Feature[];
}
