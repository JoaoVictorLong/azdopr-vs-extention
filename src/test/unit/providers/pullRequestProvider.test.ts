import * as assert from "node:assert";
import { suite, test } from "mocha";
import type { AzureDevOpsAuthProvider } from "../../../auth/authProvider";
import { REVIEWER_VOTE } from "../../../constants/azureDevOpsConstants";
import { PullRequestProvider } from "../../../providers/pullRequestProvider";
import type { AzureDevOpsClient } from "../../../services/azureDevOpsClient";
import { createMockPR } from "../../fixtures/pullRequests";

suite("PullRequestProvider - Status Badges", () => {
	const currentUserEmail = "current.user@example.com";

	// Mock AzureDevOpsClient
	function createMockClient(currentUserEmail: string): AzureDevOpsClient {
		return {
			getCurrentUser: async () => ({
				id: "current-user-id",
				displayName: "Current User",
				uniqueName: currentUserEmail,
				imageUrl: "https://example.com/avatar.jpg",
			}),
			getAllPullRequests: async () => [],
		} as unknown as AzureDevOpsClient;
	}

	// Mock AzureDevOpsAuthProvider
	function createMockAuthProvider(): AzureDevOpsAuthProvider {
		return {
			isAuthenticated: async () => true,
		} as unknown as AzureDevOpsAuthProvider;
	}

	suite("getPRStatusBadges", () => {
		test("should show approved badge when user approved PR", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			// Initialize to fetch current user
			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for background fetch

			// Create PR where current user approved
			const pr = createMockPR({
				reviewers: [
					{
						id: "current-user-id",
						displayName: "Current User",
						uniqueName: currentUserEmail,
						vote: REVIEWER_VOTE.APPROVED,
						isRequired: false,
					},
				],
			});

			// Access private method using type casting for testing
			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.ok(badges.includes("✓"), "Should include check badge");
			assert.strictEqual(badges.length, 1, "Should have exactly one badge");
		});

		test("should show approved badge when user approved with suggestions", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "current-user-id",
						displayName: "Current User",
						uniqueName: currentUserEmail,
						vote: REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.ok(badges.includes("✓"), "Should include check badge");
		});

		test("should show rejected badge when user rejected PR", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "current-user-id",
						displayName: "Current User",
						uniqueName: currentUserEmail,
						vote: REVIEWER_VOTE.REJECTED,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.ok(badges.includes("✗"), "Should include X badge");
		});

		test("should show error badge when others rejected", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "other-user-id",
						displayName: "Other User",
						uniqueName: "other.user@example.com",
						vote: REVIEWER_VOTE.REJECTED,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.ok(badges.includes("⚠"), "Should include warning badge");
		});

		test("should show clock badge when waiting for author", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "other-user-id",
						displayName: "Other User",
						uniqueName: "other.user@example.com",
						vote: REVIEWER_VOTE.WAITING_FOR_AUTHOR,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.ok(badges.includes("⏰"), "Should include clock badge");
		});

		test("should show multiple badges in correct order", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			// User approved, but others rejected
			const pr = createMockPR({
				reviewers: [
					{
						id: "current-user-id",
						displayName: "Current User",
						uniqueName: currentUserEmail,
						vote: REVIEWER_VOTE.APPROVED,
						isRequired: false,
					},
					{
						id: "other-user-id",
						displayName: "Other User",
						uniqueName: "other.user@example.com",
						vote: REVIEWER_VOTE.REJECTED,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.strictEqual(badges.length, 2, "Should have two badges");
			assert.strictEqual(badges[0], "✓", "First badge should be check");
			assert.strictEqual(badges[1], "⚠", "Second badge should be warning");
		});

		test("should handle no reviewers gracefully", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			assert.strictEqual(badges.length, 0, "Should have no badges");
		});

		test("should handle user not reviewer", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "other-user-id",
						displayName: "Other User",
						uniqueName: "other.user@example.com",
						vote: REVIEWER_VOTE.APPROVED,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			// Should not include check badge since current user is not a reviewer
			assert.ok(!badges.includes("✓"), "Should not include check badge");
		});

		test("should handle current user fetch failure", async () => {
			const mockClient = {
				getCurrentUser: async () => {
					throw new Error("Failed to fetch user");
				},
				getAllPullRequests: async () => [],
			} as unknown as AzureDevOpsClient;
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "user-id",
						displayName: "Some User",
						uniqueName: "some.user@example.com",
						vote: REVIEWER_VOTE.APPROVED,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			// Should have no badges since current user couldn't be fetched
			assert.strictEqual(badges.length, 0, "Should have no badges");
		});

		test("should prioritize rejection over waiting for author", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "user-1",
						displayName: "User 1",
						uniqueName: "user1@example.com",
						vote: REVIEWER_VOTE.REJECTED,
						isRequired: false,
					},
					{
						id: "user-2",
						displayName: "User 2",
						uniqueName: "user2@example.com",
						vote: REVIEWER_VOTE.WAITING_FOR_AUTHOR,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			// Should only show error badge, not clock badge
			assert.ok(badges.includes("⚠"), "Should include warning badge");
			assert.ok(!badges.includes("⏰"), "Should not include clock badge");
		});

		test("should not show badge when user has no vote", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				reviewers: [
					{
						id: "current-user-id",
						displayName: "Current User",
						uniqueName: currentUserEmail,
						vote: REVIEWER_VOTE.NO_VOTE,
						isRequired: false,
					},
				],
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			// Should not include any badge for no vote
			assert.ok(!badges.includes("✓"), "Should not include check badge");
			assert.ok(!badges.includes("✗"), "Should not include X badge");
		});

		test("should handle undefined reviewers array", async () => {
			const mockClient = createMockClient(currentUserEmail);
			const mockAuthProvider = createMockAuthProvider();
			const provider = new PullRequestProvider(mockClient, mockAuthProvider);

			provider.initialize();
			await new Promise((resolve) => setTimeout(resolve, 100));

			const pr = createMockPR({
				// biome-ignore lint/suspicious/noExplicitAny: Testing edge case with invalid data
				reviewers: undefined as any,
			});

			// biome-ignore lint/suspicious/noExplicitAny: Testing private method
			const badges = (provider as any).getPRStatusBadges(pr);

			// Should handle gracefully and return no badges
			assert.strictEqual(badges.length, 0, "Should have no badges");
		});
	});
});
