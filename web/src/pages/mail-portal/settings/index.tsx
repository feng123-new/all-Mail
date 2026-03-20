import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Select, Space } from 'antd';
import { mailboxPortalApi } from '../../../api';
import { requestData } from '../../../utils/request';
import { PageHeader } from '../../../components';

interface MailboxItem {
    id: number;
    address: string;
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
}

const MailPortalSettingsPage: React.FC = () => {
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [forwardLoading, setForwardLoading] = useState(false);
    const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
    const [passwordForm] = Form.useForm();
    const [forwardForm] = Form.useForm();

    const loadMailboxes = useCallback(async () => {
        const result = await requestData<MailboxItem[]>(() => mailboxPortalApi.getMailboxes(), '获取邮箱列表失败', { silent: true });
        if (result) {
            setMailboxes(result);
            if (result[0]) {
                forwardForm.setFieldsValue({
                    mailboxId: result[0].id,
                    forwardMode: result[0].forwardMode || 'DISABLED',
                    forwardTo: result[0].forwardTo || undefined,
                });
            }
        }
    }, [forwardForm]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadMailboxes();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadMailboxes]);

    const handlePasswordSubmit = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
        if (values.newPassword !== values.confirmPassword) {
            return;
        }
        setPasswordLoading(true);
        const result = await requestData(() => mailboxPortalApi.changePassword(values.oldPassword, values.newPassword), '修改密码失败');
        if (result) {
            passwordForm.resetFields();
        }
        setPasswordLoading(false);
    };

    const handleForwardSubmit = async (values: { mailboxId: number; forwardMode: 'DISABLED' | 'COPY' | 'MOVE'; forwardTo?: string }) => {
        setForwardLoading(true);
        const result = await requestData(() => mailboxPortalApi.updateForwarding({
            mailboxId: values.mailboxId,
            forwardMode: values.forwardMode,
            forwardTo: values.forwardMode === 'DISABLED' ? null : (values.forwardTo || null),
        }), '保存转发失败');
        if (result) {
            await loadMailboxes();
        }
        setForwardLoading(false);
    };

    return (
        <div>
            <PageHeader title="邮箱设置" subtitle="修改登录密码并按邮箱配置转发规则。" />
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card title="修改密码">
                    <Form layout="vertical" form={passwordForm} onFinish={handlePasswordSubmit} style={{ maxWidth: 420 }}>
                        <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                            <Input.Password />
                        </Form.Item>
                        <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '密码至少 8 位' }]}>
                            <Input.Password />
                        </Form.Item>
                        <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请确认新密码' }]}>
                            <Input.Password />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={passwordLoading}>更新密码</Button>
                    </Form>
                </Card>
                <Card title="邮件转发">
                    <Form layout="vertical" form={forwardForm} onFinish={handleForwardSubmit} style={{ maxWidth: 520 }}>
                        <Form.Item name="mailboxId" label="选择邮箱" rules={[{ required: true, message: '请选择邮箱' }]}>
                            <Select options={mailboxes.map((item) => ({ value: item.id, label: item.address }))} />
                        </Form.Item>
                        <Form.Item name="forwardMode" label="转发模式" rules={[{ required: true, message: '请选择转发模式' }]}>
                            <Select options={[{ value: 'DISABLED', label: '关闭' }, { value: 'COPY', label: '保留副本并转发' }, { value: 'MOVE', label: '转发后作为唯一副本' }]} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate>
                            {({ getFieldValue }) => getFieldValue('forwardMode') !== 'DISABLED' ? (
                                <Form.Item name="forwardTo" label="转发目标邮箱" rules={[{ required: true, message: '请输入转发目标邮箱' }, { type: 'email', message: '请输入有效邮箱地址' }]}>
                                    <Input placeholder="target@example.com" />
                                </Form.Item>
                            ) : null}
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={forwardLoading}>保存转发设置</Button>
                    </Form>
                </Card>
            </Space>
        </div>
    );
};

export default MailPortalSettingsPage;
