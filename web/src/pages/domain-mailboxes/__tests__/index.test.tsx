import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import DomainMailboxesPage from "..";

vi.mock("../../../contracts/admin/domainMailboxes", () => ({
	domainMailboxesContract: {
		getDomains: vi.fn(),
		getMailboxes: vi.fn(),
		getUsers: vi.fn(),
		getApiKeys: vi.fn(),
	},
}));

import { domainMailboxesContract } from "../../../contracts/admin/domainMailboxes";

function ok<T>(data: T) {
	return Promise.resolve({ code: 200, data });
}

describe("DomainMailboxesPage localization skeleton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(domainMailboxesContract.getDomains).mockReturnValue(
			ok({ list: [], total: 0 }) as never,
		);
		vi.mocked(domainMailboxesContract.getMailboxes).mockReturnValue(
			ok({ list: [], total: 0 }) as never,
		);
		vi.mocked(domainMailboxesContract.getUsers).mockReturnValue(
			ok({ list: [], total: 0 }) as never,
		);
		vi.mocked(domainMailboxesContract.getApiKeys).mockReturnValue(
			ok({ list: [], total: 0 }) as never,
		);
	});

	it("renders clean English top-level copy", async () => {
		render(
			<I18nProvider initialLanguage="en-US" persist={false}>
				<MemoryRouter
					future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
				>
					<DomainMailboxesPage />
				</MemoryRouter>
			</I18nProvider>,
		);

		expect(
			await screen.findByRole("heading", { name: "Domain mailboxes" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Batch create mailboxes/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Add mailbox/ }),
		).toBeInTheDocument();
	});

	it("opens the create-mailbox modal from a domain onboarding deep link", async () => {
		vi.mocked(domainMailboxesContract.getDomains).mockReturnValue(
			ok({
				list: [
					{
						id: 6,
						name: "example.com",
						status: "ACTIVE",
						canReceive: true,
						canSend: true,
					},
				],
				total: 1,
			}) as never,
		);

		render(
			<I18nProvider initialLanguage="en-US" persist={false}>
				<MemoryRouter
					initialEntries={["/domain-mailboxes?domainId=6&intent=create"]}
					future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
				>
					<DomainMailboxesPage />
				</MemoryRouter>
			</I18nProvider>,
		);

		expect(
			await screen.findByRole("heading", { name: "Domain mailboxes" }),
		).toBeInTheDocument();
		expect(
			await screen.findByText(
				"The page is pre-filtered for example.com, so you can create the first mailbox for that domain directly.",
			),
		).toBeInTheDocument();
		expect(await screen.findByText("Create mailbox")).toBeInTheDocument();
	});
});
