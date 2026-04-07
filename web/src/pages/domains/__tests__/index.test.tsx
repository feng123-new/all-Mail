import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('antd', async () => {
    const React = await vi.importActual<typeof import('react')>('react');

    type FormInstance = {
        values: Record<string, unknown>;
        setFieldsValue: (nextValues: Record<string, unknown>) => void;
        resetFields: () => void;
        setFields: (_fields: Array<{ name: string | string[]; errors?: string[] }>) => void;
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
        let submitter: ((nextValues: Record<string, unknown>) => void) | null = null;

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
            setFields() {
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

    const FormItem = ({ name, label, children, initialValue, valuePropName = 'value', hidden }: {
        name?: string;
        label?: string;
        children?: React.ReactNode;
        initialValue?: unknown;
        valuePropName?: string;
        hidden?: boolean;
    }) => {
        const form = React.useContext(FormContext);

        React.useEffect(() => {
            if (!form || !name || initialValue === undefined || form.__getValue(name) !== undefined) {
                return;
            }
            form.__setValue(name, initialValue);
        }, [form, initialValue, name]);

        if (!children) {
            return null;
        }

        if (!form || !name) {
            return hidden ? null : <div>{children}</div>;
        }

        const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>;
        const currentValue = form.__getValue(name);
        const nextProps: Record<string, unknown> = {
            'aria-label': typeof label === 'string' ? label : undefined,
            [valuePropName]: currentValue ?? (valuePropName === 'checked' ? false : ''),
            onChange: (value: unknown) => {
                const normalized = valuePropName === 'checked'
                    ? (typeof value === 'boolean' ? value : (value as { target?: { checked?: boolean } })?.target?.checked)
                    : (value as { target?: { value?: unknown } })?.target?.value ?? value;
                form.__setValue(name, normalized);
                const originalOnChange = child.props.onChange as ((nextValue: unknown) => void) | undefined;
                originalOnChange?.(value);
            },
        };

        if (hidden) {
            return React.cloneElement(child, nextProps);
        }

        return (
            <div>
                {label ? <span>{label}</span> : null}
                {React.cloneElement(child, nextProps)}
            </div>
        );
    };

    Form.Item = FormItem;

    const Input = ({ value = '', onChange, placeholder, disabled, type = 'text', ...rest }: {
        value?: unknown;
        onChange?: (event: { target: { value: string } }) => void;
        placeholder?: string;
        disabled?: boolean;
        type?: string;
        [key: string]: unknown;
    }) => {
        const ariaLabel = rest['aria-label'] as string | undefined;
        return (
        <input
            type={type}
            value={String(value ?? '')}
            onChange={(event) => onChange?.({ target: { value: event.target.value } })}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={ariaLabel}
        />
        );
    };

    Input.Password = (props: { value?: unknown; onChange?: (event: { target: { value: string } }) => void; placeholder?: string; disabled?: boolean }) => (
        <Input {...props} type="password" />
    );

    const Select = ({ value, onChange, options = [], disabled, ...rest }: {
        value?: unknown;
        onChange?: (value: string | number | undefined) => void;
        options?: Array<{ value: string | number; label: string; disabled?: boolean }>;
        disabled?: boolean;
        [key: string]: unknown;
    }) => {
        const ariaLabel = rest['aria-label'] as string | undefined;
        return (
        <select
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(event) => {
                const selected = options.find((option) => String(option.value) === event.target.value);
                onChange?.(selected?.value);
            }}
            disabled={disabled}
            aria-label={ariaLabel}
        >
            <option value="">请选择</option>
            {options.map((option) => (
                <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
                    {option.label}
                </option>
            ))}
        </select>
        );
    };

    const Switch = ({ checked = false, onChange, ...rest }: { checked?: boolean; onChange?: (checked: boolean) => void; [key: string]: unknown }) => (
        <button type="button" role="switch" aria-checked={checked} aria-label={rest['aria-label'] as string | undefined} onClick={() => onChange?.(!checked)}>
            {checked ? '开' : '关'}
        </button>
    );

    const Button = ({ children, onClick, disabled, loading, htmlType = 'button', ...rest }: {
        children?: unknown;
        onClick?: () => void;
        disabled?: boolean;
        loading?: boolean;
        htmlType?: 'button' | 'submit';
        [key: string]: unknown;
    }) => (
        <button type={htmlType} onClick={onClick} disabled={disabled || loading} aria-label={rest['aria-label'] as string | undefined}>
            {children as never}
        </button>
    );

    const Table = ({ dataSource = [], columns = [] }: {
        dataSource?: Array<Record<string, unknown>>;
        columns?: Array<Record<string, unknown>>;
    }) => (
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
    );

    return {
        Alert: ({ title, description }: { title?: unknown; description?: unknown }) => <div>{title as never}{description as never}</div>,
        Button,
        Breadcrumb: ({ items = [] }: { items?: Array<{ title: unknown }> }) => <div>{items.map((item) => <span key={String(item.title)}>{item.title as never}</span>)}</div>,
        Card: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
        Descriptions: Object.assign(({ children }: { children?: unknown }) => <div>{children as never}</div>, {
            Item: ({ label, children }: { label?: unknown; children?: unknown }) => <div><strong>{label as never}</strong>{children as never}</div>,
        }),
        Empty: ({ description }: { description?: unknown }) => <div>{description as never}</div>,
        Form,
        Input,
        Modal: ({ open, title, children, onCancel, onOk, confirmLoading, footer }: {
            open?: boolean;
            title?: string;
            children?: unknown;
            onCancel?: () => void;
            onOk?: () => void;
            confirmLoading?: boolean;
            footer?: unknown;
        }) => open ? (
            <div role="dialog" aria-label={title}>
                <div>{children as never}</div>
                {footer === null ? null : (
                    <>
                        <button type="button" onClick={onCancel}>取消</button>
                        <button type="button" onClick={onOk} disabled={confirmLoading}>确定</button>
                    </>
                )}
            </div>
        ) : null,
        Select,
        Space: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
        Switch,
        Table,
        Tag: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
        Typography: {
            Title: ({ children }: { children?: unknown }) => <h2>{children as never}</h2>,
            Text: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
        },
        message: {
            destroy: vi.fn(),
            error: vi.fn(),
            success: vi.fn(),
        },
    };
});

vi.mock('../../../contracts/admin/domains', () => ({
    domainsContract: {
        getList: vi.fn(),
        getById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        verify: vi.fn(),
        saveCatchAll: vi.fn(),
        saveSendingConfig: vi.fn(),
        getAliases: vi.fn(),
        createAlias: vi.fn(),
        updateAlias: vi.fn(),
        delete: vi.fn(),
        deleteAlias: vi.fn(),
    },
}));

import DomainsPage from '..';
import { domainsContract } from '../../../contracts/admin/domains';

function ok<T>(data: T) {
    return Promise.resolve({ code: 200, data });
}

async function clickAndFlush(name: string | RegExp) {
    await userEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
}

async function openConfigModal() {
    await clickAndFlush(/配置/);
    await waitFor(() => {
        expect(domainsContract.getById).toHaveBeenCalledWith(1);
    });
}

const listResult = {
    list: [
        {
            id: 1,
            name: 'example.com',
            displayName: 'Example',
            status: 'ACTIVE',
            canReceive: true,
            canSend: true,
            mailboxCount: 2,
        },
    ],
    total: 1,
};

const baseDetail = {
    id: 1,
    name: 'example.com',
    displayName: 'Example',
    status: 'ACTIVE',
    provider: 'hosted_internal',
    canReceive: true,
    canSend: true,
    isCatchAllEnabled: false,
    catchAllTargetMailboxId: null,
    verificationToken: 'verify-token-1',
    dnsStatus: {
        provider: 'CLOUDFLARE',
        expectedMxConfigured: true,
        expectedIngressConfigured: false,
    },
    resendDomainId: null,
    createdAt: '2026-04-05T10:00:00.000Z',
    updatedAt: '2026-04-05T10:00:00.000Z',
    creator: { id: 1, username: 'admin' },
    mailboxes: [
        { id: 11, address: 'ops@example.com', localPart: 'ops', status: 'ACTIVE', canLogin: true, isCatchAllTarget: false },
        { id: 12, address: 'alerts@example.com', localPart: 'alerts', status: 'ACTIVE', canLogin: true, isCatchAllTarget: false },
    ],
    sendingConfigs: [],
    inboundMessageCount: 4,
    outboundMessageCount: 1,
};

describe('DomainsPage hosted_internal admin closure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(domainsContract.getList).mockImplementation(() => ok(listResult) as never);
        vi.mocked(domainsContract.getById).mockImplementation(() => ok(baseDetail) as never);
        vi.mocked(domainsContract.getAliases).mockImplementation(() => ok([]) as never);
        vi.mocked(domainsContract.verify).mockImplementation(() => ok({ success: true }) as never);
        vi.mocked(domainsContract.saveCatchAll).mockImplementation(() => ok({ success: true }) as never);
        vi.mocked(domainsContract.saveSendingConfig).mockImplementation(() => ok({ success: true }) as never);
        vi.mocked(domainsContract.createAlias).mockImplementation(() => ok({ success: true }) as never);
    });

    it('loads domain detail and aliases when opening the config modal', async () => {
        render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<DomainsPage />
			</MemoryRouter>,
		);

        await screen.findByText('example.com');
        await openConfigModal();
        expect(domainsContract.getAliases).toHaveBeenCalledWith(1);

        expect(await screen.findByDisplayValue('verify-token-1')).toBeInTheDocument();
        expect(screen.getByText('暂无 Alias')).toBeInTheDocument();
    });

    it('creates the first sending config and refreshes the detail state', async () => {
        vi.mocked(domainsContract.getById)
            .mockImplementationOnce(() => ok(baseDetail) as never)
            .mockImplementationOnce(() => ok({
                ...baseDetail,
                sendingConfigs: [{
                    id: 91,
                    provider: 'RESEND',
                    fromNameDefault: 'Ops Team',
                    replyToDefault: 'reply@example.com',
                    status: 'ACTIVE',
                    createdAt: '2026-04-05T10:05:00.000Z',
                    updatedAt: '2026-04-05T10:05:00.000Z',
                }],
            }) as never);

        render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<DomainsPage />
			</MemoryRouter>,
		);

        await screen.findByText('example.com');
        await openConfigModal();

        fireEvent.change(screen.getByLabelText('默认发件人名称'), { target: { value: 'Ops Team' } });
        fireEvent.change(screen.getByLabelText('默认 Reply-To'), { target: { value: 'reply@example.com' } });
        fireEvent.change(screen.getByPlaceholderText('首次创建必须填写 API Key'), { target: { value: 'rekey1234' } });
        await clickAndFlush('保存发信配置');

        await waitFor(() => {
            expect(domainsContract.saveSendingConfig).toHaveBeenCalledWith(1, {
                provider: 'RESEND',
                fromNameDefault: 'Ops Team',
                replyToDefault: 'reply@example.com',
                apiKey: 'rekey1234',
            });
            expect(domainsContract.getById).toHaveBeenCalledTimes(2);
        });
    }, 10000);

    it('regenerates the verification token and reloads domain detail', async () => {
        vi.mocked(domainsContract.getById)
            .mockImplementationOnce(() => ok(baseDetail) as never)
            .mockImplementationOnce(() => ok({
                ...baseDetail,
                verificationToken: 'verify-token-2',
            }) as never);

        render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<DomainsPage />
			</MemoryRouter>,
		);

        await screen.findByText('example.com');
        await openConfigModal();
        await clickAndFlush('重新生成 Token');

        await waitFor(() => {
            expect(domainsContract.verify).toHaveBeenCalledWith(1);
            expect(domainsContract.getById).toHaveBeenCalledTimes(2);
        });
        expect(await screen.findByText('当前 Token：verify-token-2')).toBeInTheDocument();
    }, 10000);

    it('updates catch-all and refreshes domain detail', async () => {
        vi.mocked(domainsContract.getById)
            .mockImplementationOnce(() => ok({
                ...baseDetail,
                isCatchAllEnabled: true,
                catchAllTargetMailboxId: 11,
            }) as never)
            .mockImplementationOnce(() => ok(baseDetail) as never);

        render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<DomainsPage />
			</MemoryRouter>,
		);

        await screen.findByText('example.com');
        await openConfigModal();

        await userEvent.click(screen.getByRole('switch'));
        await clickAndFlush('保存 Catch-all');

        await waitFor(() => {
            expect(domainsContract.saveCatchAll).toHaveBeenCalledWith(1, {
                isCatchAllEnabled: false,
                catchAllTargetMailboxId: null,
            });
            expect(domainsContract.getById).toHaveBeenCalledTimes(2);
        });
    }, 10000);

    it('creates an alias with the default active mailbox and refreshes the alias list', async () => {
        vi.mocked(domainsContract.getById).mockImplementation(() => ok({
            ...baseDetail,
            mailboxes: [
                { id: 11, address: 'ops@example.com', localPart: 'ops', status: 'ACTIVE', canLogin: true, isCatchAllTarget: false },
                { id: 12, address: 'alerts@example.com', localPart: 'alerts', status: 'DISABLED', canLogin: false, isCatchAllTarget: false },
            ],
        }) as never);
        vi.mocked(domainsContract.getAliases)
            .mockImplementationOnce(() => ok([]) as never)
            .mockImplementationOnce(() => ok([
                {
                    id: 301,
                    mailboxId: 11,
                    aliasLocalPart: 'support',
                    aliasAddress: 'support@example.com',
                    status: 'ACTIVE',
                    mailbox: { id: 11, address: 'ops@example.com', status: 'ACTIVE' },
                },
            ]) as never);

        render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<DomainsPage />
			</MemoryRouter>,
		);

        await screen.findByText('example.com');
        await openConfigModal();

        await clickAndFlush(/新增 Alias/);
        await screen.findByRole('dialog', { name: /新增 Alias/ });
        fireEvent.change(screen.getByLabelText('Alias 本地部分'), { target: { value: 'support' } });
        await userEvent.click(screen.getByRole('button', { name: '确定' }));
        await Promise.resolve();

        await waitFor(() => {
            expect(domainsContract.createAlias).toHaveBeenCalledWith(1, {
                mailboxId: 11,
                aliasLocalPart: 'support',
            });
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: /新增 Alias/ })).not.toBeInTheDocument();
        });

        expect(await screen.findByText('support@example.com')).toBeInTheDocument();
	}, 15000);
});
