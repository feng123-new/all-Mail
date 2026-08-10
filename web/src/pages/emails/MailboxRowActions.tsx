import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Modal, Popconfirm, Space, Tooltip } from 'antd';
import type { FC } from 'react';
import { adminI18n } from '../../i18n/catalog/admin';
import { defineMessage } from '../../i18n/messages';
import { useI18n } from '../../i18n';
import { emailsInlineI18n } from './inlineMessages';

const rowActionI18n = {
  moreActions: defineMessage(
    'emails.row.moreActions',
    '更多操作',
    'More actions',
  ),
} as const;

interface MailboxRowActionsProps {
  compact: boolean;
  hasNewInboxMessages: boolean;
  canRevealPassword: boolean;
  hasStoredPassword: boolean;
  onOpenInbox: () => void;
  onOpenSent: () => void;
  onRevealPassword: () => void;
  onCheckConnection: () => void;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}

const MailboxRowActions: FC<MailboxRowActionsProps> = ({
  compact,
  hasNewInboxMessages,
  canRevealPassword,
  hasStoredPassword,
  onOpenInbox,
  onOpenSent,
  onRevealPassword,
  onCheckConnection,
  onEdit,
  onDelete,
}) => {
  const { t } = useI18n();
  const passwordHint = canRevealPassword
    ? t(emailsInlineI18n['emails.row.viewStoredLoginPassword'])
    : hasStoredPassword
      ? t(emailsInlineI18n['emails.row.loginPasswordStoredWith2fa'])
      : t(emailsInlineI18n['emails.row.noStoredLoginPassword']);

  if (compact) {
    const items = [
      {
        key: 'sent',
        icon: <SendOutlined />,
        label: t(adminI18n.emails.sent),
        onClick: onOpenSent,
      },
      {
        key: 'password',
        icon: <SafetyCertificateOutlined />,
        label: t(emailsInlineI18n['emails.row.loginPasswordButton']),
        onClick: onRevealPassword,
      },
      {
        key: 'check',
        icon: <ReloadOutlined />,
        label: t(adminI18n.emails.checkConnection),
        onClick: onCheckConnection,
      },
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: t(adminI18n.common.edit),
        onClick: onEdit,
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t(adminI18n.common.remove),
        danger: true,
        onClick: () => {
          Modal.confirm({
            title: t(emailsInlineI18n['emails.row.deleteConfirm']),
            okText: t(adminI18n.common.remove),
            cancelText: t(emailsInlineI18n['emails.reveal.cancelText']),
            okButtonProps: { danger: true },
            onOk: onDelete,
          });
        },
      },
    ];

    return (
      <Space wrap className="mailbox-row-actions mailbox-row-actions--compact">
        <Button
          size="small"
          type={hasNewInboxMessages ? 'primary' : 'default'}
          onClick={onOpenInbox}
        >
          {t(adminI18n.emails.inbox)}
        </Button>
        <Dropdown menu={{ items }} trigger={['click']}>
          <Button
            size="small"
            icon={<MoreOutlined />}
            aria-label={t(rowActionI18n.moreActions)}
          >
            {t(rowActionI18n.moreActions)}
          </Button>
        </Dropdown>
      </Space>
    );
  }

  return (
    <Space wrap className="mailbox-row-actions mailbox-row-actions--desktop">
      <Button
        size="small"
        type={hasNewInboxMessages ? 'primary' : 'default'}
        onClick={onOpenInbox}
      >
        {t(adminI18n.emails.inbox)}
      </Button>
      <Button size="small" onClick={onOpenSent}>
        {t(adminI18n.emails.sent)}
      </Button>
      <Tooltip title={passwordHint}>
        <Button
          size="small"
          type={canRevealPassword ? 'primary' : 'default'}
          aria-label={t(emailsInlineI18n['emails.row.loginPasswordAriaLabel'])}
          onClick={onRevealPassword}
        >
          {t(emailsInlineI18n['emails.row.loginPasswordButton'])}
        </Button>
      </Tooltip>
      <Button size="small" onClick={onCheckConnection}>
        {t(adminI18n.emails.checkConnection)}
      </Button>
      <Button size="small" onClick={onEdit}>
        {t(adminI18n.common.edit)}
      </Button>
      <Popconfirm
        title={t(emailsInlineI18n['emails.row.deleteConfirm'])}
        onConfirm={onDelete}
      >
        <Button size="small" danger>
          {t(adminI18n.common.remove)}
        </Button>
      </Popconfirm>
    </Space>
  );
};

export default MailboxRowActions;
