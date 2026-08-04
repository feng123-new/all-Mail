import { Button, Result } from 'antd';
import type { FC } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import './styles.css';

const messages = {
  title: defineMessage('notFound.title', '页面不存在', 'Page not found'),
  adminDescription: defineMessage(
    'notFound.adminDescription',
    '这个管理页面不存在或已经移动，请返回运行概况继续操作。',
    'This administration page does not exist or has moved. Return to the operating overview.',
  ),
  portalDescription: defineMessage(
    'notFound.portalDescription',
    '这个邮箱门户页面不存在或已经移动，请返回收件箱。',
    'This mailbox portal page does not exist or has moved. Return to the inbox.',
  ),
  publicDescription: defineMessage(
    'notFound.publicDescription',
    '请求的页面不存在，请返回登录入口。',
    'The requested page does not exist. Return to sign in.',
  ),
  adminAction: defineMessage('notFound.adminAction', '返回运行概况', 'Back to overview'),
  portalAction: defineMessage('notFound.portalAction', '返回收件箱', 'Back to inbox'),
  publicAction: defineMessage('notFound.publicAction', '返回登录', 'Back to sign in'),
} as const;

export type NotFoundSurface = 'admin' | 'portal' | 'public';

interface NotFoundPageProps {
  surface?: NotFoundSurface;
}

const NotFoundPage: FC<NotFoundPageProps> = ({ surface = 'public' }) => {
  const { t } = useI18n();
  const destination = surface === 'portal'
    ? '/mail/inbox'
    : surface === 'admin'
      ? '/dashboard'
      : '/login';
  const description = surface === 'portal'
    ? messages.portalDescription
    : surface === 'admin'
      ? messages.adminDescription
      : messages.publicDescription;
  const action = surface === 'portal'
    ? messages.portalAction
    : surface === 'admin'
      ? messages.adminAction
      : messages.publicAction;

  return (
    <main className="not-found-page" data-surface={surface}>
      <Result
        status="404"
        title="404"
        subTitle={t(messages.title)}
        extra={(
          <>
            <p className="not-found-description">{t(description)}</p>
            <Link to={destination}>
              <Button type="primary">{t(action)}</Button>
            </Link>
          </>
        )}
      />
    </main>
  );
};

export default NotFoundPage;
