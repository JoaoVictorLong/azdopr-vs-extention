# Change Log

All notable changes to the Azure DevOps PR Viewer extension.

## [1.2.0] - 2025-01-21

### Added

- **Project filtering** - Filter PRs to specific projects using the `includedProjects` setting
- **Response caching** - Added intelligent caching system for Azure DevOps API calls with 30-second cache for PR lists and 1-minute cache for other data
- **Cached instant display** - PRs now display immediately from cache while refreshing in background for better perceived performance
- **Comments auto-refresh** - Configurable auto-refresh interval for PR comments (default: 30 seconds)
- **Friendly error messages** - Improved error handling with user-friendly error messages

### Changed

- **Refactored comment system** - Replaced CodeLens-based commenting with VS Code's native Comments API for better integration and performance
  - Comments now appear inline as proper VS Code comment threads
  - Improved comment display with proper status labels (resolved, closed, etc.)
  - Prevented duplicate comment loads with loading state tracking
- **Parallel data fetching** - Optimized API calls to fetch projects, repositories, and PRs in parallel for significantly faster load times
- **Simplified command titles** - Shortened "Sign in to Azure DevOps PR Viewer" to "Sign In" and "Sign out from Azure DevOps PR Viewer" to "Sign Out"
- **Comment command naming** - Renamed internal comment commands for better clarity

### Removed

- **Removed CodeLens provider** - No longer using CodeLens for adding comments (replaced with native Comments API)
- **Removed decoration provider** - Removed unused gutter decoration provider
- **Removed settings**:
  - `enableInlineComments` - Comments are now always available via native API
  - `codeLensInterval` - No longer needed without CodeLens

### Fixed

- **Icon path** - Added missing icon reference in package.json for marketplace display
- **Publisher name** - Corrected publisher name casing in package.json
- **Repository URL** - Added repository URL to package.json for better marketplace integration
- **Comment loading** - Fixed duplicate comment loading issues
- **Thread labels** - Only show status labels for non-active comment threads

## [1.0.0] - 2025-01-11

### Added

- **Organization-wide pull request discovery** across all projects and repositories
- **Microsoft Entra ID OAuth authentication** via VS Code's built-in authentication provider
- **Hierarchical tree view** automatically organized by project → repository → pull request
  - Projects sorted alphabetically
  - Repositories sorted alphabetically within each project
  - PRs sorted by age (oldest first) within each repository
- **PR File Viewer** with side-by-side diff comparison
  - View file changes directly from Azure DevOps without local checkout
  - Support for all file change types (added, modified, deleted)
  - Virtual file system for seamless PR file browsing
- **Inline PR Commenting**
  - Add comments directly to specific lines in PR diffs
  - CodeLens integration with configurable "Add Comment" buttons
  - Works on both sides of diff (original and modified)
  - Context menu support for adding comments
  - Comments posted immediately to Azure DevOps
- **Auto-refresh** with configurable interval (default: 5 minutes)
- **Rich PR information display** with tooltips showing:
  - Author, creation date, and age
  - Source and target branches
  - Reviewer status with vote indicators
  - PR description preview
  - Draft status
- **Interactive actions**:
  - Click any PR to view details in VS Code
  - Right-click to open PR in web browser
  - Add inline comments via CodeLens or context menu
- **Visual indicators**:
  - Icons for projects (📁), repositories (📦), PRs, and draft PRs
  - Approval status indicators (✅ ❌ 👍 ⏳ ⏸️)
  - PR counts displayed for each project and repository
- **Configuration settings**:
  - Organization name
  - Auto-refresh interval
  - Max PRs to fetch per project
  - Enable/disable inline comment CodeLens
  - CodeLens interval (show on every N lines)
- **Activity bar icon** for easy access to PR view
- **Commands** for refresh, sign in/out, view PR, open in browser, and add comments
