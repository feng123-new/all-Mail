import { Alert, Button, Input, Modal, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { readGmailLoginDetails, updateGmailLoginDetails, type GmailLoginDetails, type GmailLoginEdits } from '../../api/gmailLoginDetails';
import { emailsContract } from '../../contracts/admin/emails';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import { useAuthStore } from '../../stores/authStore';
import { fullWidthStyle } from '../../styles/common';
import { gmailWorkspaceI18n } from './gmailWorkspaceMessages';

const copy = {
  account: defineMessage('gmailDetails.account', '已保存的 Gmail 账号', 'Saved Gmail account'),
  notice: defineMessage('gmailDetails.notice', '这些资料仅供手动登录 Google。日常收发邮件继续使用已有连接。', 'Use these details to sign into Google manually. Your existing connection still handles mail.'),
  twoFactorRequired: defineMessage('gmailDetails.twoFactorRequired', '请先启用 all-Mail 管理员两步验证。', 'Enable all-Mail admin two-factor authentication first.'),
  adminCode: defineMessage('gmailDetails.adminCode', 'all-Mail 管理员验证码', 'all-Mail admin code'),
  unlock: defineMessage('gmailDetails.unlock', '解锁', 'Unlock'),
  lock: defineMessage('gmailDetails.lock', '锁定', 'Lock'),
  unlockFailed: defineMessage('gmailDetails.unlockFailed', '无法解锁。请检查 all-Mail 管理员验证码并重试。', 'Could not unlock. Check the all-Mail admin code and try again.'),
  expired: defineMessage('gmailDetails.expired', '解锁已过期，请重新验证。', 'Unlock expired. Verify again.'),
  accountChanged: defineMessage('gmailDetails.accountChanged', '账号已变更或删除。请关闭窗口并刷新账号列表。', 'This account changed or was removed. Close the dialog and refresh the account list.'),
  password: defineMessage('gmailDetails.password', 'Google 登录密码', 'Google login password'),
  newPassword: defineMessage('gmailDetails.newPassword', '新的 Google 登录密码', 'New Google login password'),
  revealPassword: defineMessage('gmailDetails.revealPassword', '显示密码', 'Reveal password'),
  hidePassword: defineMessage('gmailDetails.hidePassword', '隐藏密码', 'Hide password'),
  copyPassword: defineMessage('gmailDetails.copyPassword', '复制密码', 'Copy password'),
  clearPassword: defineMessage('gmailDetails.clearPassword', '清除密码', 'Clear password'),
  key: defineMessage('gmailDetails.key', 'Google 验证器设置密钥', 'Google Authenticator setup key'),
  keyHint: defineMessage('gmailDetails.keyHint', '仅支持验证器设置用的 Base32 密钥，请勿填写 6 位验证码。留空则不更改密钥。', 'Enter the Base32 setup key, not a six-digit code. Leave blank to keep the current key.'),
  invalidKey: defineMessage('gmailDetails.invalidKey', '请输入有效的 Google 验证器 Base32 设置密钥。', 'Enter a Base32 Google Authenticator setup key.'),
  code: defineMessage('gmailDetails.code', 'Google 动态验证码', 'Google verification code'),
  codeExpires: defineMessage('gmailDetails.codeExpires', '{seconds} 秒后过期', 'Expires in {seconds} s'),
  codeExpired: defineMessage('gmailDetails.codeExpired', '验证码已过期', 'Code expired'),
  codeRefresh: defineMessage('gmailDetails.codeRefresh', '刷新 Google 动态码', 'Refresh Google code'),
  copyCode: defineMessage('gmailDetails.copyCode', '复制动态码', 'Copy code'),
  clearKey: defineMessage('gmailDetails.clearKey', '清除密钥', 'Clear setup key'),
  noValue: defineMessage('gmailDetails.noValue', '未保存', 'Not saved'),
  notes: defineMessage('gmailDetails.notes', '备注（纯文本）', 'Plaintext notes'),
  copyNotes: defineMessage('gmailDetails.copyNotes', '复制备注', 'Copy notes'),
  clearNotes: defineMessage('gmailDetails.clearNotes', '清除备注', 'Clear notes'),
  save: defineMessage('gmailDetails.save', '保存修改', 'Save changes'),
  saved: defineMessage('gmailDetails.saved', '已保存', 'Saved'),
  copied: defineMessage('gmailDetails.copied', '已复制', 'Copied'),
  copyFailed: defineMessage('gmailDetails.copyFailed', '复制失败，可手动选中内容复制。', 'Copy failed. You can select and copy the value manually.'),
  unavailable: defineMessage('gmailDetails.unavailable', '无法读取或更新登录资料。请重试。', 'Could not read or update login details. Try again.'),
} as const;

type Account = { id: number; email: string };
type Unlocked = { account: Account; grantToken: string; expiresAt: number; codeExpiresAt: number; data: GmailLoginDetails };
const errorCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? error.code : undefined;
const localDeadline = (expiry: string | null, serverTime: string, requestedAt: number) =>
  expiry ? requestedAt + Date.parse(expiry) - Date.parse(serverTime) : 0;

export default function GmailLoginDetailsDialog({ accounts, initialId, onClose }: {
  accounts: Account[];
  initialId?: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const admin = useAuthStore((state) => state.admin);
  const [id, setId] = useState(initialId ?? (accounts.length === 1 ? accounts[0].id : undefined));
  const [otp, setOTP] = useState('');
  const [unlocked, setUnlocked] = useState<Unlocked>();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [notes, setNotes] = useState('');
  const [now, setNow] = useState(() => performance.now());
  const [error, setError] = useState<typeof copy.unlockFailed>();
  const [notice, setNotice] = useState<typeof copy.saved>();
  const inputs = useId();
  const request = useRef<AbortController | undefined>(undefined);
  const account = accounts.find((item) => item.id === id);
  const stillSelected = account?.id === unlocked?.account.id && account?.email === unlocked?.account.email;

  const clear = useCallback(() => {
    setUnlocked(undefined);
    setShown(false);
    setOTP('');
    setPassword('');
    setKey('');
    setNotes('');
    setNotice(undefined);
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => useAuthStore.subscribe((state, prior) => {
    if (prior.admin?.twoFactorEnabled && (state.admin?.id !== prior.admin.id || !state.admin?.twoFactorEnabled)) {
      request.current?.abort();
      clear();
      setBusy(false);
    }
  }), [clear]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => {
      const current = performance.now();
      setNow(current);
      if (current >= unlocked.expiresAt || !stillSelected) {
        request.current?.abort();
        clear();
        setBusy(false);
        setError(stillSelected ? copy.expired : copy.accountChanged);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [unlocked, stillSelected, clear]);

  const withRequest = async (operation: (signal: AbortSignal) => Promise<void>, fallback: typeof copy.unlockFailed) => {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation(controller.signal);
    } catch (failure: unknown) {
      if (controller.signal.aborted) return;
      if (errorCode(failure) === 'REVEAL_UNLOCK_EXPIRED') {
        clear();
        setError(copy.expired);
      } else if (errorCode(failure) === 'INVALID_GMAIL_TOTP_SECRET') {
        setError(copy.invalidKey);
      } else if (errorCode(failure) === 'NOT_FOUND' || errorCode(failure) === 404) {
        clear();
        setError(copy.accountChanged);
      } else {
        setError(fallback);
      }
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };

  const unlock = async () => {
    if (!account || !admin?.twoFactorEnabled || !/^\d{6}$/.test(otp)) return;
    await withRequest(async (signal) => {
      const grant = await emailsContract.revealUnlock({ otp });
      if (signal.aborted) return;
      if (grant.code !== 200) throw new Error('Unlock rejected');
      setOTP('');
      const requestedAt = performance.now();
      const result = await readGmailLoginDetails(account.id, account.email, grant.data.grantToken, false, signal);
      if (signal.aborted) return;
      if (result.code !== 200) throw new Error('Read rejected');
      const current = performance.now();
      const expiresAt = localDeadline(grant.data.expiresAt, result.data.serverTime, requestedAt);
      if (!Number.isFinite(expiresAt) || current >= expiresAt) { setError(copy.expired); return; }
      const codeExpiresAt = localDeadline(result.data.codeExpiresAt, result.data.serverTime, requestedAt);
      setNow(current);
      setNotes(result.data.notes ?? '');
      setUnlocked({ account, grantToken: grant.data.grantToken, expiresAt, codeExpiresAt, data: result.data });
    }, copy.unlockFailed);
  };

  const readCode = async () => {
    if (!unlocked || !stillSelected || performance.now() >= unlocked.expiresAt) return;
    await withRequest(async (signal) => {
      const requestedAt = performance.now();
      const result = await readGmailLoginDetails(unlocked.account.id, unlocked.account.email, unlocked.grantToken, true, signal);
      if (signal.aborted) return;
      if (result.code !== 200) throw new Error('Read rejected');
      const { code, codeExpiresAt, serverTime } = result.data;
      const current = performance.now();
      if (current >= unlocked.expiresAt) { clear(); setError(copy.expired); return; }
      setNow(current);
      setUnlocked({ ...unlocked, codeExpiresAt: localDeadline(codeExpiresAt, serverTime, requestedAt), data: { ...unlocked.data, code, codeExpiresAt } });
    }, copy.unavailable);
  };

  const save = async (edits: GmailLoginEdits) => {
    if (!unlocked || !stillSelected || performance.now() >= unlocked.expiresAt) return;
    await withRequest(async (signal) => {
      const { id, email } = unlocked.account;
      const updated = await updateGmailLoginDetails(id, email, unlocked.grantToken, edits, signal);
      if (signal.aborted) return;
      if (updated.code !== 200) throw new Error('Update rejected');
      if (edits.password !== undefined) setPassword('');
      if (edits.totpSecret !== undefined) setKey('');
      setShown(false);
      const requestedAt = performance.now();
      try {
        const result = await readGmailLoginDetails(id, email, unlocked.grantToken, false, signal);
        if (signal.aborted) return;
        if (result.code !== 200) throw new Error('Read rejected');
        const current = performance.now();
        if (current >= unlocked.expiresAt) { clear(); setError(copy.expired); return; }
        setNow(current);
        if (edits.notes !== undefined || notes === (unlocked.data.notes ?? '')) setNotes(result.data.notes ?? '');
        setUnlocked({ ...unlocked, codeExpiresAt: localDeadline(result.data.codeExpiresAt, result.data.serverTime, requestedAt), data: result.data });
        setNotice(copy.saved);
      } catch (error) {
        if (!signal.aborted) clear();
        throw error;
      }
    }, copy.unavailable);
  };

  const saveChanges = () => {
    const normalizedKey = key.replace(/\s/g, '').replace(/=+$/, '').toUpperCase();
    if (key && !/^[A-Z2-7]{16,103}$/.test(normalizedKey)) {
      setError(copy.invalidKey);
      return;
    }
    const edits: GmailLoginEdits = {};
    if (password) edits.password = password;
    if (normalizedKey) edits.totpSecret = normalizedKey;
    if (notes !== (unlocked?.data.notes ?? '')) edits.notes = notes;
    if (Object.keys(edits).length) void save(edits);
  };

  const copyValue = async (value: string, isCode = false) => {
    if (!unlocked) return;
    const current = performance.now();
    if (!stillSelected || current >= unlocked.expiresAt || (isCode && current >= unlocked.codeExpiresAt)) return;
    try {
      await navigator.clipboard.writeText(value);
      setNotice(copy.copied);
    } catch {
      setError(copy.copyFailed);
    }
  };

  const active = admin?.twoFactorEnabled && unlocked && stillSelected && now < unlocked.expiresAt ? unlocked : undefined;
  const data = active?.data;
  const seconds = active ? Math.ceil((active.codeExpiresAt - now) / 1000) : 0;
  const liveCode = seconds > 0 ? data?.code : null;
  const footer = active ? (
    <Space wrap>
      <Button disabled={busy} onClick={() => { clear(); setError(undefined); }}>{t(copy.lock)}</Button>
      <Button type="primary" loading={busy} disabled={!password && !key && notes === (data?.notes ?? '')} onClick={saveChanges}>{t(copy.save)}</Button>
    </Space>
  ) : null;

  return (
    <Modal open centered title={t(gmailWorkspaceI18n.loginDetails)} footer={footer} onCancel={onClose}
      styles={{ body: { maxHeight: '70dvh', overflowY: 'auto' } }}>
      <Space orientation="vertical" style={fullWidthStyle} size="middle">
        <Typography.Text type="secondary">{t(copy.notice)}</Typography.Text>
        <Select
          aria-label={t(copy.account)} placeholder={t(copy.account)} value={id} disabled={busy || !!active}
          style={fullWidthStyle} virtual={false} showSearch optionFilterProp="label"
          options={accounts.map((account) => ({ value: account.id, label: account.email }))}
          onChange={(selected: number) => { clear(); setError(undefined); setId(selected); }}
        />
        {!admin?.twoFactorEnabled ? <Alert type="info" showIcon title={t(copy.twoFactorRequired)} /> : !active ? (
          <Space orientation="vertical" style={fullWidthStyle}>
            <label htmlFor={`${inputs}-otp`}>{t(copy.adminCode)}</label>
            <Input id={`${inputs}-otp`} value={otp} onChange={(e) => setOTP(e.target.value)} inputMode="numeric"
              autoComplete="off" maxLength={6} disabled={busy} onPressEnter={() => void unlock()} />
            <Button type="primary" loading={busy} disabled={!account || !/^\d{6}$/.test(otp)} onClick={() => void unlock()}>{t(copy.unlock)}</Button>
          </Space>
        ) : (
          <Space orientation="vertical" style={fullWidthStyle} size="middle">
            <div>
              <Typography.Text strong>{t(copy.password)}: </Typography.Text>
              <Typography.Text>{data?.password ? (shown ? data.password : '••••••••') : t(copy.noValue)}</Typography.Text>
              {data?.password && <Space wrap>
                <Button disabled={busy} onClick={() => setShown(!shown)}>{t(shown ? copy.hidePassword : copy.revealPassword)}</Button>
                <Button disabled={busy} onClick={() => void copyValue(data.password ?? '')}>{t(copy.copyPassword)}</Button>
              </Space>}
              <Space orientation="vertical" style={fullWidthStyle}>
                <label htmlFor={`${inputs}-password`}>{t(copy.newPassword)}</label>
                <Input.Password id={`${inputs}-password`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={256} disabled={busy} />
                <Button disabled={busy || !data?.password} onClick={() => void save({ password: '' })}>{t(copy.clearPassword)}</Button>
              </Space>
            </div>
            <Space orientation="vertical" style={fullWidthStyle}>
              <Typography.Text strong>{t(copy.code)}</Typography.Text>
              {liveCode ? <Space wrap><Typography.Text code>{liveCode}</Typography.Text><span>{t(copy.codeExpires, { seconds })}</span></Space>
                : <Typography.Text type="secondary">{t(data?.code ? copy.codeExpired : copy.noValue)}</Typography.Text>}
              <Space wrap>
                <Button disabled={busy || !data?.code} onClick={() => void readCode()}>{t(copy.codeRefresh)}</Button>
                {liveCode && <Button disabled={busy} onClick={() => void copyValue(liveCode, true)}>{t(copy.copyCode)}</Button>}
              </Space>
              <label htmlFor={`${inputs}-key`}>{t(copy.key)}</label>
              <Input.Password id={`${inputs}-key`} value={key} onChange={(e) => setKey(e.target.value)} visibilityToggle={false} autoComplete="new-password" maxLength={256} disabled={busy} />
              <Typography.Text type="secondary">{t(copy.keyHint)}</Typography.Text>
              <Button disabled={busy || !data?.code} onClick={() => void save({ totpSecret: '' })}>{t(copy.clearKey)}</Button>
            </Space>
            <Space orientation="vertical" style={fullWidthStyle}>
              <label htmlFor={`${inputs}-notes`}>{t(copy.notes)}</label>
              <Input.TextArea id={`${inputs}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" maxLength={8000} rows={3} disabled={busy} />
              <Space wrap>
                <Button disabled={!notes} onClick={() => void copyValue(notes)}>{t(copy.copyNotes)}</Button>
                <Button disabled={busy || !data?.notes} onClick={() => void save({ notes: '' })}>{t(copy.clearNotes)}</Button>
              </Space>
            </Space>
          </Space>
        )}
        {error && <Alert type="error" showIcon title={t(error)} />}
        {notice && <Alert type="success" showIcon title={t(notice)} />}
      </Space>
    </Modal>
  );
}
