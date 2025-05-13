export interface FileMetadata {
    path: string;
    type?: string;
}
export interface FeatureBundle {
    id?: string;
    name: string;
    description: string;
    version: string;
    files: string[];
    iconUrl?: string;
    dependencies?: string[];
    packageDependencies?: string[];
    availability?: 'public' | 'dependency';
    tags?: string[];
}
export interface Package {
    name: string;
    namespace: string;
    packageId: string;
    versionId: string;
    description: string;
    version: string;
    documentation?: string;
}
export interface IndexData {
    title?: string;
    description?: string;
    bundles: FeatureBundle[];
    packages: Package[];
}
export interface MarketplaceConfigPaths {
    packages: string;
    bundles: string;
}
export interface MarketplaceConfig {
    paths: MarketplaceConfigPaths;
    title?: string;
    description?: string;
}
export type SalesforceMetadataType = 'ApexClass' | 'ApexComponent' | 'ApexPage' | 'ApexTrigger' | 'AssignmentRules' | 'AuraDefinitionBundle' | 'AuthProvider' | 'AutoResponseRules' | 'Certificate' | 'ChatterExtension' | 'CleanDataService' | 'Community' | 'CompactLayout' | 'ConnectedApp' | 'ContentAsset' | 'CorsWhitelistOrigin' | 'CustomApplication' | 'CustomApplicationComponent' | 'CustomFeedFilter' | 'CustomField' | 'CustomLabels' | 'CustomMetadata' | 'CustomObject' | 'CustomObjectTranslation' | 'CustomPageWebLink' | 'CustomPermission' | 'CustomSite' | 'CustomTab' | 'Dashboard' | 'DataCategoryGroup' | 'Document' | 'DuplicateRule' | 'EmailTemplate' | 'EmbeddedServiceBranding' | 'EmbeddedServiceConfig' | 'EmbeddedServiceFlowConfig' | 'EmbeddedServiceLiveAgent' | 'EventDelivery' | 'EventSubscription' | 'ExternalServiceRegistration' | 'FieldSet' | 'FlexiPage' | 'Flow' | 'FlowCategory' | 'FlowDefinition' | 'GlobalValueSet' | 'GlobalValueSetTranslation' | 'HomePageComponent' | 'HomePageLayout' | 'InstalledPackage' | 'KeywordList' | 'Layout' | 'LightningBolt' | 'LightningComponentBundle' | 'LightningExperienceTheme' | 'LightningMessageChannel' | 'LightningOnboardingConfig' | 'ListView' | 'LiveChatAgentConfig' | 'LiveChatButton' | 'LiveChatDeployment' | 'LiveChatSensitiveDataRule' | 'ManagedTopics' | 'MatchingRule' | 'MilestoneType' | 'ModerationRule' | 'MyDomainDiscoverableLogin' | 'NamedCredential' | 'Network' | 'PathAssistant' | 'PermissionSet' | 'PermissionSetGroup' | 'PlatformEventChannel' | 'PlatformEventChannelMember' | 'Portal' | 'PostTemplate' | 'Profile' | 'Queue' | 'QuickAction' | 'RecommendationStrategy' | 'RecordActionDeployment' | 'RecordType' | 'RemoteSiteSetting' | 'Report' | 'ReportType' | 'Role' | 'SamlSsoConfig' | 'Scontrol' | 'ServiceChannel' | 'ServicePresenceStatus' | 'SharingRules' | 'SharingSet' | 'SiteDotCom' | 'Skill' | 'StandardValueSet' | 'StandardValueSetTranslation' | 'StaticResource' | 'Territory' | 'Territory2' | 'Territory2Model' | 'Territory2Rule' | 'Territory2Type' | 'TopicsForObjects' | 'TransactionSecurityPolicy' | 'Translations' | 'UserCriteria' | 'ValidationRule' | 'WebLink' | 'Workflow';
export declare const metadataTypeFolderMappings: Record<string, SalesforceMetadataType>;
export type SalesforcePackageXmlType = {
    [K in keyof typeof metadataTypeFolderMappings]: string[];
};
