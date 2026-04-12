import { adminI18n } from './catalog/admin';
import { providerI18n } from './catalog/providers';
import { providerSetupI18n } from './catalog/providerSetup';
import {
  collectMessageDescriptors,
  type AppLanguage,
  type MessageDescriptor,
} from './messages';

function buildDescriptorEntries(
  descriptors: MessageDescriptor[],
): Record<AppLanguage, Record<string, string>> {
  const resources: Record<AppLanguage, Record<string, string>> = {
    'zh-CN': {},
    'en-US': {},
  };

  for (const descriptor of descriptors) {
    resources['zh-CN'][descriptor.key] = descriptor.messages['zh-CN'];
    resources['en-US'][descriptor.key] = descriptor.messages['en-US'];
  }

  return resources;
}

const descriptorResources = buildDescriptorEntries([
  ...collectMessageDescriptors(adminI18n),
  ...collectMessageDescriptors(providerI18n),
  ...collectMessageDescriptors(providerSetupI18n),
]);

const appResources: Record<AppLanguage, Record<string, string>> = {
  'zh-CN': {
    'api.error.REQUEST_FAILED': '请求失败，请稍后重试。',
    'api.error.REQUEST_TIMEOUT': '请求超时，请稍后重试。',
    'api.error.REQUEST_CANCELED': '请求已取消。',
    'api.error.NETWORK_ERROR': '网络异常，请检查连接后重试。',
    'api.error.VALIDATION_ERROR': '提交内容校验失败，请检查后重试。',
    'api.error.INTERNAL_ERROR': '服务暂时不可用，请稍后重试。',
    'api.error.NOT_FOUND': '请求的资源不存在。',
    'api.error.UNAUTHORIZED': '认证已失效，请重新登录。',
    'api.error.INVALID_TOKEN': '登录状态已失效，请重新登录。',
    'api.error.ACCOUNT_DISABLED': '当前账号已被禁用。',
    'api.error.PASSWORD_CHANGE_REQUIRED': '当前账号需要先修改初始密码。',
    'api.error.INVALID_API_KEY': 'API Key 无效。',
    'api.error.API_KEY_DISABLED': 'API Key 已被禁用。',
    'api.error.API_KEY_EXPIRED': 'API Key 已过期。',
    'api.error.FORBIDDEN_PERMISSION': '当前凭据没有执行该操作的权限。',
    'api.error.FORBIDDEN': '当前账号没有访问权限。',
    'api.error.AUTH_REQUIRED': '当前操作需要认证后才能继续。',
    'api.error.MAILBOX_CLEAR_UNSUPPORTED': '当前邮箱连接方式不支持该清理操作。',
    'api.error.GROUP_NOT_FOUND': '邮箱分组不存在。',
    'api.error.GROUP_EXISTS': '邮箱分组名称已存在。',
    'api.error.DUPLICATE_EMAIL': '该邮箱已存在。',
    'api.error.INVALID_OTP': '验证码错误，请重试。',
    'api.error.OAUTH_PROVIDER_UNSUPPORTED': '当前服务商暂不支持 OAuth。',
    'api.error.OAUTH_STATE_INVALID': '授权状态已失效，请重新发起连接。',
  'api.error.OAUTH_CALLBACK_MISSING_STATE': '授权回调缺少 state 参数。',
  'api.error.OAUTH_CALLBACK_MISSING_CODE': '授权回调缺少 authorization code。',
  'api.error.OAUTH_STATUS_FORBIDDEN': '当前账号不能查看该授权状态。',
  'api.error.DOMAIN_NOT_FOUND': '域名不存在。',
	'api.error.DOMAIN_NOT_EMPTY': '当前域名仍有关联邮箱或未清理的域名消息，无法删除。请先到“域名邮箱”和“域名消息”页面完成清理。',
    'result.AUTH_LOGGED_OUT': '已退出登录。',
    'result.AUTH_PASSWORD_CHANGED': '密码修改成功。',
    'result.MAILBOX_PORTAL_LOGGED_OUT': '已退出邮箱门户。',
    'result.ADMIN_DELETED': '管理员已删除。',
    'result.API_KEY_DELETED': '访问密钥已删除。',
    'result.API_KEY_ALLOCATION_RESET': '分配记录已重置。',
    'result.EMAIL_ACCOUNT_DELETED': '邮箱账号已删除。',
    'admin.role.superAdmin': '超级管理员',
    'admin.role.admin': '管理员',
    'admin.status.active': '启用',
    'admin.status.disabled': '禁用',
  },
  'en-US': {
    'api.error.REQUEST_FAILED': 'The request failed. Please try again.',
    'api.error.REQUEST_TIMEOUT': 'The request timed out. Please try again.',
    'api.error.REQUEST_CANCELED': 'The request was canceled.',
    'api.error.NETWORK_ERROR': 'Network error. Check the connection and try again.',
    'api.error.VALIDATION_ERROR': 'Validation failed. Review the input and try again.',
    'api.error.INTERNAL_ERROR': 'The service is temporarily unavailable. Please try again later.',
    'api.error.NOT_FOUND': 'The requested resource was not found.',
    'api.error.UNAUTHORIZED': 'Authentication has expired. Please sign in again.',
    'api.error.INVALID_TOKEN': 'The sign-in session is no longer valid. Please sign in again.',
    'api.error.ACCOUNT_DISABLED': 'This account is disabled.',
    'api.error.PASSWORD_CHANGE_REQUIRED': 'This account must change the initial password first.',
    'api.error.INVALID_API_KEY': 'The API key is invalid.',
    'api.error.API_KEY_DISABLED': 'The API key is disabled.',
    'api.error.API_KEY_EXPIRED': 'The API key has expired.',
    'api.error.FORBIDDEN_PERMISSION': 'The current credential is not allowed to perform this action.',
    'api.error.FORBIDDEN': 'This account is not allowed to access that resource.',
    'api.error.AUTH_REQUIRED': 'Authentication is required before continuing.',
    'api.error.MAILBOX_CLEAR_UNSUPPORTED': 'The current mailbox connection does not support this clear operation.',
    'api.error.GROUP_NOT_FOUND': 'The mailbox group was not found.',
    'api.error.GROUP_EXISTS': 'The mailbox group name already exists.',
    'api.error.DUPLICATE_EMAIL': 'That email account already exists.',
    'api.error.INVALID_OTP': 'The verification code is invalid. Try again.',
    'api.error.OAUTH_PROVIDER_UNSUPPORTED': 'OAuth is not supported for that provider yet.',
    'api.error.OAUTH_STATE_INVALID': 'The authorization state has expired. Start the connection again.',
  'api.error.OAUTH_CALLBACK_MISSING_STATE': 'The OAuth callback is missing the state parameter.',
  'api.error.OAUTH_CALLBACK_MISSING_CODE': 'The OAuth callback is missing the authorization code.',
  'api.error.OAUTH_STATUS_FORBIDDEN': 'This account cannot inspect that authorization state.',
  'api.error.DOMAIN_NOT_FOUND': 'The domain was not found.',
	'api.error.DOMAIN_NOT_EMPTY': 'This domain still has linked mailboxes or uncleared domain messages and cannot be deleted. Clear them from the Domain Mailboxes and Domain Messages pages first.',
    'result.AUTH_LOGGED_OUT': 'Signed out.',
    'result.AUTH_PASSWORD_CHANGED': 'Password changed.',
    'result.MAILBOX_PORTAL_LOGGED_OUT': 'Signed out of the mailbox portal.',
    'result.ADMIN_DELETED': 'Admin deleted.',
    'result.API_KEY_DELETED': 'API key deleted.',
    'result.API_KEY_ALLOCATION_RESET': 'Allocation history reset.',
    'result.EMAIL_ACCOUNT_DELETED': 'Email account deleted.',
    'admin.role.superAdmin': 'Super admin',
    'admin.role.admin': 'Admin',
    'admin.status.active': 'Active',
    'admin.status.disabled': 'Disabled',
  },
};

export const resources: Record<AppLanguage, { translation: Record<string, string> }> = {
  'zh-CN': {
    translation: {
      ...descriptorResources['zh-CN'],
      ...appResources['zh-CN'],
    },
  },
  'en-US': {
    translation: {
      ...descriptorResources['en-US'],
      ...appResources['en-US'],
    },
  },
};
