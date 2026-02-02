# Azure DevOps PR Viewer

[![Publish VS Code Extension](https://github.com/johncwaters/azdopr/actions/workflows/main.yml/badge.svg)](https://github.com/johncwaters/azdopr/actions/workflows/main.yml)

View and review all your organization's Azure DevOps pull requests directly in VS Code. No more browser switching.

## Features

- **Organization-wide view** - See all PRs across every project and repository
- **In-editor code review** - View diffs, add comments, and resolve threads
- **At-a-glance status** - Icon colors show which PRs need your attention
- **Smart sorting** - PRs needing your review appear first
- **Smart caching** - Fast performance with automatic refresh
- **Project filtering** - Focus on specific projects when needed
- **Git LFS support** - View binary files like PDFs (experimental)

## Sidebar Guide

**Icon Colors**
| Color | Meaning |
|-------|---------|
| 🟠 Orange | Needs your review |
| 🟢 Green | You approved |
| 🔴 Red | Blocked or rejected |
| 🔵 Blue | Your PR |
| ⚪ Gray | Draft |

**Badges** - Repositories show a count of PRs awaiting your review.

**Sorting** - PRs are ordered by priority: needs review → blocked → waiting → reviewed.

## Getting Started

1. **Configure your organization**
   Open VS Code settings and set `azureDevOpsPRViewer.organization` to your Azure DevOps organization name.
   - From `https://dev.azure.com/myorg` → use `myorg`
   - From `https://myorg.visualstudio.com` → use `myorg`

2. **Sign in**
   Click "Sign In" in the sidebar and authenticate with your Microsoft account.

3. **Start reviewing**
   Browse PRs, view file changes, and add comments—all without leaving VS Code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow. This extension is still in development and open to help!
