import { beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
	requestDelete: vi.fn(),
	requestGet: vi.fn(),
	requestPost: vi.fn(),
	requestPut: vi.fn(),
}));

vi.mock("./core", () => ({
	...coreMocks,
	LONG_RUNNING_CHECK_TIMEOUT_MS: 180_000,
}));

import { emailApi } from "./emails";

describe("emailApi", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the provider timeout when viewing mailbox messages", () => {
		emailApi.viewMails(30, "INBOX", true);

		expect(coreMocks.requestGet).toHaveBeenCalledWith(
			"/admin/emails/30/mails",
			{
				params: { mailbox: "INBOX", markAsSeen: true },
				timeout: 180_000,
			},
		);
	});
});
