# Azure DevOps PR Viewer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Stop switching between VS Code and your browser to review pull requests.**

Azure DevOps PR Viewer brings all your organization's pull requests directly into VS Code. Review code, add comments, and manage PRs without ever leaving your editor.

## What is this?

If you work with Azure DevOps and spend time reviewing pull requests, this extension is for you. It gives you a complete view of every pull request across your entire organization—all projects, all repositories—in one convenient sidebar.

## Why use it?

**Stay in your workflow**
No more context switching. Review PRs in the same window where you write code.

**See everything at once**
Get a bird's-eye view of all active pull requests across your organization. Never miss an important review.

**Review faster**
View file changes, add inline comments, and resolve threads right in VS Code. Everything you need for code review in one place.

**Work your way**
Focus on specific projects when you need to, or see everything when you want the big picture.

## Getting Started

### Step 1: Tell it your organization

Open the extension settings and enter your Azure DevOps organization name.

Find it in your Azure DevOps URL:
- `https://dev.azure.com/myorg` → your organization is `myorg`
- `https://myorg.visualstudio.com` → your organization is `myorg`

### Step 2: Sign in

Click "Sign In" in the sidebar and authenticate with your Microsoft account. That's it—your pull requests will appear automatically.

## What can you do?

### Browse all your pull requests

All PRs are organized by project and repository, so you can quickly find what you're looking for. Click any PR to see its details and file changes.

### Review code changes

Click a file to see exactly what changed, just like you would in Azure DevOps. The side-by-side diff makes it easy to spot issues.

### Comment on code

See a problem or want to suggest something? Hover over any line and click the comment icon. Your comment goes straight to Azure DevOps where the author can see it.

### View binary files (Git LFS support)

The extension includes experimental support for viewing Git LFS files (currently PDF documents). Click any LFS-tracked file in the "Files Changed" tab to view it directly in VS Code.

### Edit and manage comments

Made a typo? Click the edit button on your own comments to fix them. You can also delete your comments or mark entire discussion threads as resolved.

### Stay up to date

The extension automatically refreshes so you always see the latest PRs and comments. You can also click the refresh button anytime you want to check for updates.

### Focus on what matters

Have dozens of projects but only work on a few? Use the project filter in settings to show only the PRs you care about.

## Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, or documentation improvements, your help is appreciated.

To get started:

1. Read our [Contributing Guidelines](CONTRIBUTING.md) for development setup and workflow
2. Look for issues labeled `good first issue` or `help wanted`
3. Feel free to open an issue to discuss your ideas before starting work

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2025 John C. Waters

## Common Questions

**Do I need to clone repositories to review them?**
No! You can view and review any PR without having the code on your machine.

**Can I approve or reject PRs?**
Currently you can view PRs, see file changes, and add comments. Voting/approval features may be added in future updates.

**Will it slow down VS Code?**
The extension uses smart caching to stay fast. It only fetches new data when needed and shows you cached results instantly.

**Something not working?**
Check the Output panel (View → Output, then select "Azure DevOps PR Viewer") to see what's happening. Most issues are related to organization name typos or authentication.
