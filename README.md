# Azure DevOps PR Viewer

View all Pull Requests across your Azure DevOps organization in VS Code.

## Features

- View all PRs across all projects and repositories in your organization
- Filter PRs to specific projects for focused workflow
- Microsoft Entra ID authentication
- PRs grouped by Project → Repository → Pull Request
- View and diff PR files without local checkout
- Add inline comments directly to PR diffs using VS Code's native commenting API
- Auto-refresh with intelligent caching for improved performance
- Manual refresh options

## Quick Start

### 1. Configure Your Organization

Click the gear icon (⚙️) in the Azure DevOps PR Viewer sidebar and enter your organization name.

**How to find your organization name:**

- If your URL is `https://dev.azure.com/myorg` → enter `myorg`
- If your URL is `https://myorg.visualstudio.com` → enter `myorg`

### 2. Sign In

1. Click "Sign in to Azure DevOps PR Viewer"
2. Authenticate with your Microsoft account
3. Approve Azure DevOps permissions

Your PRs will load automatically.

## Settings

- `azureDevOpsPRViewer.organization`: Your Azure DevOps organization name
- `azureDevOpsPRViewer.autoRefreshInterval`: Auto-refresh interval in seconds (default: 300, set to 0 to disable)
- `azureDevOpsPRViewer.maxPRsToFetch`: Maximum PRs to fetch per project (default: 500)
- `azureDevOpsPRViewer.includedProjects`: Filter to specific projects (default: [], empty array = all projects)
- `azureDevOpsPRViewer.commentsAutoRefreshInterval`: Auto-refresh interval for comments in seconds (default: 30, set to 0 to disable)

## Usage

### View PRs

PRs are displayed hierarchically:

- Projects (sorted alphabetically)
- Repositories within each project (sorted alphabetically)
- PRs within each repository (sorted by age, oldest first)

Click any PR to view details. Right-click to open in browser.

### Add Comments to PR Diffs

1. Click on a file in the PR viewer to open the diff
2. Hover over any line to see the comment icon (+)
3. Click the comment icon and enter your comment

Comments are displayed inline using VS Code's native commenting system, showing existing PR comments and allowing you to add new ones directly to Azure DevOps.

### Troubleshooting

**Authentication Issues:**

- Sign out and back in from the Command Palette
- Ensure your Microsoft account has access to your Azure DevOps organization
- Verify your organization is connected to Microsoft Entra ID

**PRs Not Loading:**

- Click the refresh icon in the sidebar
- Check Output panel (View → Output) → "Azure DevOps PR Viewer" for errors
- Verify your organization name in settings

## Release Notes

### 1.2.0

- Added project filtering to focus on specific projects
- Improved performance with intelligent caching and parallel data fetching
- Refactored commenting system to use VS Code's native Comments API
- Added auto-refresh for comments
- Simplified UI with shorter command titles
- Fixed marketplace display with proper icon and repository URL

### 1.0.0

Initial release
