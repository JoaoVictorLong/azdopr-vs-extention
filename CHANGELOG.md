# Change Log

All notable changes to the Azure DevOps PR Viewer extension.

## [1.8.0] - 2025-02-02:

### Added

- **Reviewed files tracking** - Track which files you've reviewed in a PR with persistent state
  - Files marked as reviewed are visually distinguished in the file list
  - Review status persists across sessions
  - Path normalization ensures consistent tracking
- **Notification vs discussion distinction** - System notification comments are now visually separated from user discussions
- **HTML sanitization for comments** - Improved security and display for comment content with proper HTML handling

### Changed

- **Enhanced PR commenting experience** - Rich editing and interactivity improvements
  - Better comment formatting and display
  - Improved UX for comment threads
- **Improved sidebar clarity** - Cleaner, more intuitive sidebar organization

### Fixed

- **URL substring sanitization** - Security fix for incomplete URL validation (code scanning alert #2)

## [1.7.0] - 2025-01-27

### Added

- **Checkout Branch command** - Checkout PR source branches locally directly from VS Code
  - Right-click on any PR to checkout its branch
  - Automatically handles remote tracking
- **Comprehensive test suite** - Added extensive unit tests for:
  - PR status badges and user fetching logic
  - Azure DevOps authentication and constants
  - Test helpers and utilities

### Changed

- **Enhanced PR handling and caching** - Improved performance and reliability for PR operations
- **Refactored error handling and logging** - Better error messages and logging mechanisms
- **Consolidated test configurations** - Improved code quality and test organization

### Fixed

- **Workflow permissions** - Security fix for workflow permission configuration (code scanning alert #1)

### Removed

- Obsolete extension test file
- Unused ESLint configuration

## [1.6.0] - 2025-01-20

### Added

- **GitHub Actions publishing workflow** - Automated extension publishing to VS Code Marketplace
- **Release scripts** - npm scripts for patch, minor, and major version releases
- **Code of Conduct** - Added Contributor Covenant Code of Conduct

### Changed

- **Streamlined README** - Simplified and clarified documentation
- **Removed license badge** - Cleaner presentation in README

### Security

- Dependency updates for js-yaml, glob, and jws

## [1.5.0] - 2025-01-15

### Added

- **Logging service** - Centralized logging for better debugging and diagnostics
- **Cache configuration** - Configurable caching behavior for API responses

### Changed

- **Git LFS infrastructure** - Implemented file handling infrastructure supporting various file types
- **Updated contribution guidelines** - Improved templates and security policies

### Fixed

- **Windows device name handling** - Added artifacts to .gitignore for Windows compatibility

## [1.4.0-beta.1] - 2025-12-10

### Added

- **Git LFS Support** - View binary files stored in Git LFS directly in VS Code
  - **PDF viewing** - Open PDF files from PRs in VS Code's built-in PDF viewer
  - **Automatic LFS detection** - Extension automatically detects LFS pointer files and downloads actual content
  - **Fast API-based downloads** - Uses Azure DevOps API with `resolveLfs` parameter for efficient file retrieval
  - **Intelligent caching** - Two-tier cache system (memory + disk) for instant re-opening of LFS files
  - **Extensible architecture** - File handler registry pattern allows easy addition of new file types
- **LFS file cache management** - "Clear LFS File Cache" command to manage cached binary files
- **Configuration settings for LFS**:
  - `azureDevOpsPRViewer.lfs.enabled` - Enable/disable LFS support (default: true)
  - `azureDevOpsPRViewer.lfs.cacheSize` - Maximum cache size in MB (default: 500)
  - `azureDevOpsPRViewer.lfs.supportedTypes` - Array of supported file types (default: ["pdf"])

### Changed

- **Upgraded Azure DevOps API version** - Updated from 7.0 to 7.1 for LFS support
- **Enhanced file handling** - Added binary file detection and specialized handlers for different file types

### Technical

- New `LfsService` for handling LFS file downloads via Azure DevOps API
- New `LfsCache` with configurable size limits and LRU eviction
- File handler registry pattern with initial handlers:
  - `PdfFileHandler` - PDF file support (MVP)
  - `ImageFileHandler` - Image file support (scaffold for future)
  - `FallbackBinaryHandler` - Graceful handling of unsupported file types
- Extended `AzureDevOpsClient` with `getFileContentWithLfs()` method
- Integrated LFS detection and handling into `PullRequestViewerPanel`

## [1.3.0] - 2025-12-10

### Added

- **Comment timestamps** - Comments now display when they were posted with relative time formatting (e.g., "2 hours ago")
- **Comment labels** - Pending and draft comments are visually distinguished with status labels
- **Edit comments** - Users can now edit their own comments directly from the comment thread
- **Delete comments** - Users can delete their own comments with proper permission checks
- **Resolve/Unresolve threads** - Thread resolution state management with resolve and unresolve commands
- **Comment event coordination** - New `CommentEventCoordinator` service for centralized comment event handling
- **Enhanced comment formatting** - Improved markdown processing and comment display with new `CommentFormatter` utility
- **Type-safe comment structures** - Added dedicated TypeScript types for comments and threads

### Changed

- **Refactored comment architecture** - Reorganized comment-related code into specialized services and utilities
  - Introduced `commentEventCoordinator.ts` for coordinating comment updates and events
  - Created `commentFormatter.ts` for consistent comment rendering
  - Split type definitions into `commentThread.ts` and `comments.ts` for better organization
- **Enhanced comment permissions** - Context-aware menu items that appear only when users have appropriate permissions
  - Edit button visible only for user's own comments
  - Delete button visible only for user's own comments
- **Improved comment controller** - Enhanced `PRCommentController` with better state management and event handling
- **Updated comment provider** - Refined `PRCommentsProvider` for more efficient comment data management

### Removed

- **Conventional comments** - Removed `conventionalComments.ts` in favor of more flexible comment formatting system

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
