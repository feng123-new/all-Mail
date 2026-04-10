import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForwardingJobsPage from '..';

vi.mock('../../../contracts/admin/forwardingJobs', () => ({
    forwardingJobsContract: {
      getDomains: vi.fn(),
      getMailboxes: vi.fn(),
      getList: vi.fn(),
      getById: vi.fn(),
      requeue: vi.fn(),
    },
  }));

import { forwardingJobsContract } from '../../../contracts/admin/forwardingJobs';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('ForwardingJobsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(forwardingJobsContract.getDomains).mockReturnValue(ok({ list: [{ id: 1, name: 'example.com' }] }) as never);
    vi.mocked(forwardingJobsContract.getMailboxes).mockReturnValue(ok({ list: [{ id: 2, address: 'ops@example.com' }] }) as never);
  });

  it('renders empty state for no forwarding jobs', async () => {
    vi.mocked(forwardingJobsContract.getList).mockReturnValue(ok({ list: [], total: 0, page: 1, pageSize: 20 }) as never);

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <ForwardingJobsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('转发任务')).toBeInTheDocument();
    expect(await screen.findByText('暂无转发任务')).toBeInTheDocument();
  });

  it('renders rows and opens the detail drawer', async () => {
    vi.mocked(forwardingJobsContract.getList).mockReturnValue(ok({
      list: [{
        id: '42',
        inboundMessageId: '101',
        mailboxId: 2,
        domainId: 1,
        mode: 'COPY',
        forwardTo: 'target@example.net',
        status: 'FAILED',
        attemptCount: 2,
        providerMessageId: null,
        nextAttemptAt: '2026-03-29T12:10:00.000Z',
        processedAt: '2026-03-29T12:00:00.000Z',
        createdAt: '2026-03-29T11:50:00.000Z',
        updatedAt: '2026-03-29T12:00:00.000Z',
        lastError: 'Transient send error',
        mailbox: { id: 2, address: 'ops@example.com', provisioningMode: 'API_POOL' },
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
        inboundMessage: {
          id: '101',
          fromAddress: 'sender@example.org',
          subject: 'Need help',
          matchedAddress: 'ops@example.com',
          finalAddress: 'ops@example.com',
          routeKind: 'EXACT_MAILBOX',
          receivedAt: '2026-03-29T11:49:00.000Z',
          portalState: 'VISIBLE',
        },
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    }) as never);
    vi.mocked(forwardingJobsContract.getById).mockReturnValue(ok({
      id: '42',
      inboundMessageId: '101',
      mailboxId: 2,
      domainId: 1,
      mode: 'COPY',
      forwardTo: 'target@example.net',
      status: 'FAILED',
      attemptCount: 2,
      providerMessageId: 'provider-1',
      nextAttemptAt: '2026-03-29T12:10:00.000Z',
      processedAt: '2026-03-29T12:00:00.000Z',
      createdAt: '2026-03-29T11:50:00.000Z',
      updatedAt: '2026-03-29T12:00:00.000Z',
      lastError: 'Transient send error',
      mailbox: { id: 2, address: 'ops@example.com', provisioningMode: 'API_POOL', forwardMode: 'COPY', forwardTo: 'target@example.net' },
      domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
      inboundMessage: {
        id: '101',
        fromAddress: 'sender@example.org',
        subject: 'Need help',
        matchedAddress: 'ops@example.com',
        finalAddress: 'ops@example.com',
        routeKind: 'EXACT_MAILBOX',
        receivedAt: '2026-03-29T11:49:00.000Z',
        portalState: 'VISIBLE',
        hasTextPreview: true,
        hasHtmlPreview: false,
      },
    }) as never);

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <ForwardingJobsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('失败')).toBeInTheDocument();
    expect(screen.getByText('保留副本并转发')).toBeInTheDocument();

    await userEvent.click(screen.getByText('42'));

    await waitFor(() => {
      expect(screen.getByText('任务状态')).toBeInTheDocument();
      expect(screen.getByText('Transient send error')).toBeInTheDocument();
      expect(screen.getByText('服务商消息 ID：')).toBeInTheDocument();
    });
  });

  it('allows admins to requeue a failed forwarding job and refreshes the list', async () => {
    vi.mocked(forwardingJobsContract.getList)
      .mockReturnValueOnce(ok({
        list: [{
          id: '42',
          inboundMessageId: '101',
          mailboxId: 2,
          domainId: 1,
          mode: 'COPY',
          forwardTo: 'target@example.net',
          status: 'FAILED',
          attemptCount: 2,
          providerMessageId: null,
          nextAttemptAt: null,
          processedAt: '2026-03-29T12:00:00.000Z',
          createdAt: '2026-03-29T11:50:00.000Z',
          updatedAt: '2026-03-29T12:00:00.000Z',
          lastError: 'Transient send error',
          mailbox: { id: 2, address: 'ops@example.com', provisioningMode: 'API_POOL' },
          domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
          inboundMessage: {
            id: '101',
            fromAddress: 'sender@example.org',
            subject: 'Need help',
            matchedAddress: 'ops@example.com',
            finalAddress: 'ops@example.com',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: '2026-03-29T11:49:00.000Z',
            portalState: 'VISIBLE',
          },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }) as never)
      .mockReturnValueOnce(ok({
        list: [{
          id: '42',
          inboundMessageId: '101',
          mailboxId: 2,
          domainId: 1,
          mode: 'COPY',
          forwardTo: 'target@example.net',
          status: 'PENDING',
          attemptCount: 0,
          providerMessageId: null,
          nextAttemptAt: '2026-03-29T12:05:00.000Z',
          processedAt: null,
          createdAt: '2026-03-29T11:50:00.000Z',
          updatedAt: '2026-03-29T12:01:00.000Z',
          lastError: null,
          mailbox: { id: 2, address: 'ops@example.com', provisioningMode: 'API_POOL' },
          domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
          inboundMessage: {
            id: '101',
            fromAddress: 'sender@example.org',
            subject: 'Need help',
            matchedAddress: 'ops@example.com',
            finalAddress: 'ops@example.com',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: '2026-03-29T11:49:00.000Z',
            portalState: 'VISIBLE',
          },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }) as never);
    vi.mocked(forwardingJobsContract.requeue).mockReturnValue(ok({
      id: '42',
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: '2026-03-29T12:05:00.000Z',
      processedAt: null,
      updatedAt: '2026-03-29T12:01:00.000Z',
      lastError: null,
      providerMessageId: null,
    }) as never);

    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <ForwardingJobsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新入队' }));
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(forwardingJobsContract.requeue).toHaveBeenCalledWith('42');
      expect(forwardingJobsContract.getList).toHaveBeenCalledTimes(2);
      expect(screen.getByText('待处理')).toBeInTheDocument();
    });
  }, 20000);
});
