# Contributing

Thank you for your interest in contributing to this extension! This project welcomes contributions and suggestions.

After cloning and building, check out the [issues list](https://github.com/johncwaters/azdopr/issues). Issues labeled **good first issue** are great candidates to work on. If you're new to writing extensions for VS Code, reading through some of the [documentation on extensions](https://code.visualstudio.com/api) is helpful.

## Build and Run

### Prerequisites

- **Git**
- **Node.js**, >= 18.x
- **Visual Studio Code**

If you want to explore the source code of this extension yourself, it's easy to get started:

1. Clone the repository
2. Install dependencies
3. Compile the TypeScript code
4. Run and debug by pressing **F5** in VS Code

See `package.json` for available build scripts.

## Tests

Run the test suite to ensure your changes work correctly:

```
npm test
```

This will compile, lint, run all tests, and generate a coverage report. Tests are organized into:

- **Unit tests** - Individual module testing
- **Integration tests** - Multi-module interactions
- **E2E tests** - Full extension workflows

Test files mirror the `src/` structure and include fixtures and helpers for common test scenarios.

## Architecture

This extension uses several VS Code APIs to provide pull request viewing and review capabilities. At a high level, the code in `src/` is organized into:

- **auth/**: Microsoft Entra OAuth authentication flow
- **services/**: Core business logic (API client, caching, LFS handling)
- **providers/**: VS Code tree views and comment providers
- **views/**: Webview panels for PR details
- **types/**: TypeScript interfaces and type definitions
- **utils/**: Utility functions and formatters
- **constants/**: Configuration and API constants

The entry point is **extension.ts**.

### Key VS Code APIs Used

- **TreeDataProvider**: Pull Requests tree view
- **WebviewPanel**: PR details page
- **CommentController**: Inline comments on files
- **TextDocumentContentProvider**: File content for diffs
- **Authentication API**: Microsoft authentication for Azure DevOps

### External Dependencies

- **Azure DevOps REST API v7.0**: PRs, comments, file changes
- **Microsoft Entra OAuth**: Authentication
- **HTTP client**: API requests
- **Markdown parser**: Comment rendering

## Code Quality

Run linting and formatting checks before submitting your pull request. Fix any errors that are reported.

## Making Contributions

### Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) to file bug reports. Include:

- A clear description of the issue
- Steps to reproduce the problem
- Expected vs. actual behavior
- Your environment (VS Code version, OS, extension version)
- Screenshots or error messages if applicable

### Suggesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) to suggest new features. Describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternative solutions you've considered

## Pull Requests

Before creating a pull request, if the issue involves making changes to the UI, please discuss it in the issue beforehand. This will help keep reviews focused on the code changes.

### Submitting a Pull Request

1. Fork and clone the repository
2. Create a new branch for your changes
3. Make your changes following our coding conventions
4. Add or update tests for your changes
5. Ensure all tests pass and linting checks succeed
6. Commit your changes with clear, descriptive messages
7. Push to your fork and submit a pull request

### Commit Message Guidelines

We follow conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Build process or auxiliary tool changes

### Coding Conventions

- Use TypeScript's strict mode
- Prefer `const` over `let`
- Use descriptive variable and function names
- Keep functions small and focused (single responsibility)
- Add JSDoc comments for public APIs
- Handle errors gracefully
- Use async/await for asynchronous operations
- Avoid over-engineering - keep it simple

## Code of Conduct

This project follows a Code of Conduct to ensure a welcoming and inclusive community. Be considerate to others and try to be courteous and professional at all times.

### Our Standards

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, trolling, or insulting/derogatory comments
- Personal or political attacks
- Publishing others' private information
- Other conduct that could reasonably be considered inappropriate

If you experience or witness unacceptable behavior, please report it by opening an issue.

## Questions?

If you have questions or need help:

1. Check existing [issues](https://github.com/johncwaters/azdopr/issues) and discussions
2. Open a new issue with the "question" label
3. Review the [documentation](https://github.com/johncwaters/azdopr#readme)

## License

By contributing to Azure DevOps PR Viewer, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing! 🎉
