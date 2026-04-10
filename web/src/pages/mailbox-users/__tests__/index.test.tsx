import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', async () => {
	const React = await vi.importActual<typeof import('react')>('react');

	type FormInstance = {
		values: Record<string, unknown>;
		setFieldsValue: (nextValues: Record<string, unknown>) => void;
		resetFields: () => void;
		submit: () => void;
		__connect: (submitter: (values: Record<string, unknown>) => void, rerender: () => void) => void;
		__disconnect: () => void;
		__setValue: (name: string, value: unknown) => void;
		__getValue: (name: string) => unknown;
	};

	const FormContext = React.createContext<FormInstance | null>(null);

	function createFormInstance(): FormInstance {
		let values: Record<string, unknown> = {};
		let rerender: (() => void) | null = null;
		let submitter: ((values: Record<string, unknown>) => void) | null = null;

		const emit = () => rerender?.();

		return {
			values,
			setFieldsValue(nextValues) {
				values = { ...values, ...nextValues };
				this.values = values;
				emit();
			},
			resetFields() {
				values = {};
				this.values = values;
				emit();
			},
			submit() {
				submitter?.({ ...values });
			},
			__connect(nextSubmitter, nextRerender) {
				submitter = nextSubmitter;
				rerender = nextRerender;
			},
			__disconnect() {
				submitter = null;
				rerender = null;
			},
			__setValue(name, value) {
				values = { ...values, [name]: value };
				this.values = values;
				emit();
			},
			__getValue(name) {
				return values[name];
			},
		};
	}

	const Form = ({ form, children, onFinish }: { form?: FormInstance; children?: unknown; onFinish?: (values: Record<string, unknown>) => void }) => {
		const [, forceUpdate] = React.useReducer((count: number) => count + 1, 0);

		React.useEffect(() => {
			if (!form) {
				return;
			}
			form.__connect((values) => {
				onFinish?.(values);
			}, () => {
				forceUpdate();
			});
			return () => {
				form.__disconnect();
			};
		}, [form, onFinish]);

		return (
			<FormContext.Provider value={form ?? null}>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form?.submit();
					}}
				>
					{children as never}
				</form>
			</FormContext.Provider>
		);
	};

	Form.useForm = () => {
		const formRef = React.useRef<FormInstance | undefined>(undefined);
		if (!formRef.current) {
			formRef.current = createFormInstance();
		}
		return [formRef.current];
	};

	const FormItem = ({ name, label, children, valuePropName = 'value' }: {
		name?: string;
		label?: string;
		children?: React.ReactNode;
		valuePropName?: string;
	}) => {
		const form = React.useContext(FormContext);
		if (!children) {
			return null;
		}
		if (!form || !name) {
			return <div>{children}</div>;
		}

		const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>;
		const nextProps: Record<string, unknown> = {
			'aria-label': typeof label === 'string' ? label : undefined,
			[valuePropName]: form.__getValue(name) ?? (valuePropName === 'checked' ? false : ''),
			onChange: (value: unknown) => {
				const normalized = (value as { target?: { value?: unknown } })?.target?.value ?? value;
				form.__setValue(name, normalized);
				const originalOnChange = child.props.onChange as ((nextValue: unknown) => void) | undefined;
				originalOnChange?.(value);
			},
		};

		return (
			<div>
				{label ? <span>{label}</span> : null}
				{React.cloneElement(child, nextProps)}
			</div>
		);
	};

	Form.Item = FormItem;

	const Input = ({ value = '', onChange, placeholder, disabled, type = 'text', ...rest }: { value?: unknown; onChange?: (event: { target: { value: string } }) => void; placeholder?: string; disabled?: boolean; type?: string; [key: string]: unknown }) => (
		<input
			type={type}
			value={String(value ?? '')}
			onChange={(event) => onChange?.({ target: { value: event.target.value } })}
			placeholder={placeholder}
			disabled={disabled}
			aria-label={rest['aria-label'] as string | undefined}
		/>
	);

	Input.Password = (props: { value?: unknown; onChange?: (event: { target: { value: string } }) => void; placeholder?: string; disabled?: boolean; [key: string]: unknown }) => (
		<Input {...props} type="password" />
	);
	return {
		Breadcrumb: ({ items = [] }: { items?: Array<{ title: unknown }> }) => <div>{items.map((item) => <span key={String(item.title)}>{item.title as never}</span>)}</div>,
		Button: ({ children, onClick, disabled, htmlType = 'button' }: { children?: unknown; onClick?: () => void; disabled?: boolean; htmlType?: 'button' | 'submit' }) => <button type={htmlType} onClick={onClick} disabled={disabled}>{children as never}</button>,
		Card: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
		Form,
		Input,
		message: { destroy: vi.fn(), error: vi.fn(), success: vi.fn() },
		Tooltip: ({ children }: { children?: unknown }) => <>{children as never}</>,
		Popconfirm: ({ children }: { children?: unknown }) => <>{children as never}</>,
		Space: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
		Tag: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
		Table: ({ dataSource = [], columns = [] }: { dataSource?: Array<Record<string, unknown>>; columns?: Array<Record<string, unknown>> }) => (
			<div>
				{dataSource.map((record, rowIndex) => (
					<div key={String(record.id ?? rowIndex)}>
						{columns.map((column, columnIndex) => {
							const dataIndex = column.dataIndex as string | undefined;
							const value = dataIndex ? record[dataIndex] : undefined;
							if (typeof column.render === 'function') {
								return <div key={String(column.key ?? columnIndex)}>{column.render(value, record, rowIndex)}</div>;
							}
							return <div key={String(column.key ?? columnIndex)}>{value as never}</div>;
						})}
					</div>
				))}
			</div>
		),
		Select: ({ options = [], mode }: { options?: Array<{ value: string | number; label: string }>; mode?: string }) => (
			<div data-testid="mock-select" data-mode={mode || 'single'}>
				{options.map((option) => (
					<div key={String(option.value)}>{option.label}</div>
				))}
			</div>
		),
		Modal: ({ open, title, children, onCancel, onOk, confirmLoading }: {
			open?: boolean;
			title?: string;
			children?: unknown;
			onCancel?: () => void;
			onOk?: () => void;
			confirmLoading?: boolean;
		}) => open ? (
			<div role="dialog" aria-label={title}>
				<div>{children as never}</div>
				<button type="button" onClick={onCancel}>取消</button>
				<button type="button" onClick={onOk} disabled={confirmLoading}>确定</button>
			</div>
		) : null,
		Typography: {
			Title: ({ children }: { children?: unknown }) => <h2>{children as never}</h2>,
			Text: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
		},
	};
});

import MailboxUsersPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/mailboxUsers', () => ({
	mailboxUsersContract: {
		getUsers: vi.fn(),
		getById: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		addMailboxes: vi.fn(),
		delete: vi.fn(),
		getMailboxes: vi.fn(),
	},
}));

import { mailboxUsersContract } from '../../../contracts/admin/mailboxUsers';

function ok<T>(data: T) {
	return Promise.resolve({ code: 200, data });
}

describe('MailboxUsersPage editing flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(mailboxUsersContract.getUsers).mockReturnValue(
			ok({
				list: [
					{
						id: 1,
						username: 'portal-user',
						email: 'portal@example.com',
						status: 'ACTIVE',
						mustChangePassword: false,
						mailboxCount: 2,
					},
				],
				total: 1,
			}) as never,
		);
		vi.mocked(mailboxUsersContract.getMailboxes).mockReturnValue(
			ok({
				list: [
					{ id: 11, address: 'first@example.com' },
					{ id: 12, address: 'second@example.com' },
				],
				total: 2,
			}) as never,
		);
		vi.mocked(mailboxUsersContract.getById).mockReturnValue(
			ok({
				id: 1,
				email: 'portal@example.com',
				status: 'ACTIVE',
				memberships: [
					{ mailbox: { id: 11 } },
					{ mailbox: { id: 12 } },
				],
			}) as never,
		);
		vi.mocked(mailboxUsersContract.update).mockReturnValue(
			ok({ success: true }) as never,
		);
	});

	it('loads current mailbox memberships before editing continues', async () => {
		const { unmount } = render(
			<I18nProvider initialLanguage="zh-CN" persist={false}>
				<MemoryRouter
					future={{
						v7_relativeSplatPath: true,
						v7_startTransition: true,
					}}
				>
					<MailboxUsersPage />
				</MemoryRouter>
			</I18nProvider>,
		);

		await screen.findByText('portal-user');
		await userEvent.click(screen.getByRole('button', { name: /编\s*辑/ }));

		await waitFor(() => {
			expect(mailboxUsersContract.getById).toHaveBeenCalledWith(1);
		});
		await screen.findByDisplayValue('portal@example.com');
		expect(await screen.findByText('first@example.com')).toBeInTheDocument();
		expect(await screen.findByText('second@example.com')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: /cancel|取消/i }));
		await waitFor(() => {
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
		unmount();
		await new Promise<void>((resolve) => setImmediate(() => resolve()));
	}, 10000);

	it('renders clean English actions and statuses when the language is en-US', async () => {
		render(
			<I18nProvider initialLanguage="en-US" persist={false}>
				<MemoryRouter
					future={{
						v7_relativeSplatPath: true,
						v7_startTransition: true,
					}}
				>
					<MailboxUsersPage />
				</MemoryRouter>
			</I18nProvider>,
		);

		expect(await screen.findByRole('heading', { name: 'Portal users' })).toBeInTheDocument();
		expect(await screen.findByText('portal-user')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add portal user' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Portal login/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Copy link/ })).toBeInTheDocument();
		expect(screen.getByText('Enabled')).toBeInTheDocument();
		expect(screen.queryByText('门户登录')).not.toBeInTheDocument();
	});
});
