import { Button } from 'antd';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DataToolbar,
  SectionHeading,
  StatusBadge,
  WorkspaceEmpty,
  WorkspaceFrame,
} from '../DataWorkspace';

describe('DataWorkspace primitives', () => {
  it('marks the active workspace kind for route-level styling', () => {
    render(
      <WorkspaceFrame kind="resource">
        <div>Mailbox resources</div>
      </WorkspaceFrame>,
    );

    const content = screen.getByText('Mailbox resources');
    expect(content.parentElement).toHaveAttribute('data-workspace', 'resource');
    expect(content.parentElement).toHaveClass('workspace-frame--resource');
  });

  it('keeps filters, metadata, and actions in explicit toolbar regions', () => {
    render(
      <DataToolbar
        filters={<label htmlFor="query">Filter<input id="query" /></label>}
        meta={<span>42 results</span>}
        actions={<Button>Add mailbox</Button>}
      />,
    );

    expect(screen.getByLabelText('Filter')).toBeInTheDocument();
    expect(screen.getByText('42 results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add mailbox' })).toBeInTheDocument();
  });

  it('renders semantic status and empty states without Ant Design tag color coupling', () => {
    render(
      <>
        <StatusBadge tone="danger">Connection error</StatusBadge>
        <WorkspaceEmpty
          title="No mailboxes"
          description="Create the first mailbox connection."
          action={<Button>Create</Button>}
        />
      </>,
    );

    expect(screen.getByText('Connection error').closest('.status-badge')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByText('No mailboxes')).toBeInTheDocument();
    expect(screen.getByText('Create the first mailbox connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('keeps section copy and actions in separate hierarchy levels', () => {
    render(
      <SectionHeading
        title="Domain mailboxes"
        description="Manage allocation and portal access."
        actions={<Button>Import</Button>}
      />,
    );

    expect(screen.getByText('Domain mailboxes')).toHaveClass('section-heading__title');
    expect(screen.getByText('Manage allocation and portal access.')).toHaveClass('section-heading__description');
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });
});
