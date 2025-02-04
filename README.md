# Cloud Coach Marketplace Release GitHub Action

![example workflow](https://github.com/cloudcoach-actions/marketplace-release/actions/workflows/release.yml/badge.svg?label=Build%20Status)

This GitHub Action automates the process of handling custom feature marketplace releases. The content is bundled and published as a release asset in GitHub. This enables the repository to be used as a custom marketplace within Cloud Coach applications.

## Details

When the action runs the following steps are performed:

- **Load Marketplace Configuration**: Loads configuration from `marketplace.json`.
- **Handle Dependencies**: Recursively processes feature dependencies and ensures they are included in the generated install packages.
- **Create Salesforce Package Metadata**: Generates `sfdx-project.json` and `package.xml` files, then uses the Salesforce CLI to create metadata packages for both install and uninstall operations.
- **Managed Packages**: Reads through the managed packages and combines README.md files with `sfpackage.json` content.
- **Create index.json**: Creates an `index.json` file that is used by the Marketplace UI to render features and bundles.
- **Upload Release Assets**: Uploads generated artifacts and index.json as GitHub release assets.

## Dependencies

- [Salesforce CLI](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm)

## Usage

### Repository Setup

Here is an example of how a marketplace repository should be setup with the following basic structure:

```bash
├── .github/
│   └── workflows
├── src/
│   ├── packages/
│   │   ├── feature1/
│   │   │   ├── classes/
│   │   │   │   ├── Feature1.cls
│   │   │   │   └── Feature1.cls-meta.xml
│   │   │   └── info.json
│   │   └── feature2/
│   │       ├── classes/
│   │       │   ├── Feature2.cls
│   │       │   └── Feature2.cls-meta.xml
│   │       └── info.json
│   └── bundles/
│       ├── package1/
│       │   ├── README.md
│       │   └── sfpackage.json
│       ├── package2/
│       │   ├── README.md
│       │   └── sfpackage.json
│       ├── README.md
│       └── sfpackage.json
└── marketplace.json
```

### .github/workflows

The workflow to execute the Marketplace Release GitHub action should be placed inside this folder (e.g. `release.yml`).

### src/packages

The packages directory contains feature folders. Each feature gets compiled into individual install and uninstall zip files and attached as a release asset. Within each feature folder, an `info.json` is required to define any associated details. Features may optionally declare dependencies on other packages within the same repository (up to 1 level of depth).

#### Example

```json
{
  "name": "Feature 1",
  "description": "Plan projects with interactive Gantt charts that adjust in real-time. Gain clarity on timelines, dependencies, and milestones.",
  "packageDependencies": ["project_cloud"],
  "availability": "public",
  "tags": ["project-management"]
}
```

### src/bundles

The bundles directory contains definitions for managed packages that will be listed in a feature marketplace. Package definitions are defined in `sfpackage.json` files within the root or subfolders. Optionally a `README.md` file can be created alongside package definitions which will provide additional documentation when viewed in the marketplace UI.

#### Example

```json
{
  "name": "DataShield - Vault",
  "namespace": "data_shield",
  "packageId": "04t2K000000cfI6QAI",
  "versionId": "....",
  "description": "xyz",
  "version": "21.2"
}
```
> Note: `sfpackage.json` files may contain a single top level object or an array of packages following the same convention.

### marketplace.json

The `marketplace.json` file is used to define paths to the bundles and package folders within the repository. This information is used by the action to determine the relevant folder paths to use.

#### Example

```json
{
  "paths": {
    "packages": "src/packages",
    "bundles": "src/bundles"
  }
}
```

### Workflow

To use this GitHub Action, create a workflow YAML file in your repository's `.github/workflows` directory. Below is an example workflow configuration which will run on pushes to the `main` branch:

```yaml
name: Marketplace Release

on:
  push:
    branches:
      - main

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    name: Build Release
    permissions:
      contents: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Install Salesforce CLI
        run: npm install -g @salesforce/cli

      - name: Run Marketplace Release Action
        uses: cloudcoach-actions/marketplace-release@v1
        env:
          SF_DISABLE_TELEMETRY: true
        with:
          api-version: '62.0'
          github-token: ${{ github.token }}
          release-version: 'v0.0.1'
```

## Customizing

### Inputs

The following inputs can be used as `step.with` keys:

| Name              | Type   | Required | Description                                                                                                             |     |
| ----------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| `api-version`     | String |          | The Salesforce API version to use when generating package metadata (default `62.0`)                                     |     |
| `github-token`    | String |          | GitHub Token used to authenticate against a repository for [Git context](#git-context) (default `${{ github.token }}` ) |     |
| `release-version` | String | `true`   | The version number used to tag the release (default `v1.0.0`)                                                           |     |
