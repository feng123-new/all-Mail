import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MailboxUser {
    id: number;
    username: string;
    email?: string | null;
    mustChangePassword?: boolean;
    mailboxIds?: number[];
}

interface MailboxAuthState {
    token: string | null;
    mailboxUser: MailboxUser | null;
    isAuthenticated: boolean;
    setAuth: (token: string, mailboxUser: MailboxUser) => void;
    clearAuth: () => void;
}

export const useMailboxAuthStore = create<MailboxAuthState>()(
    persist(
        (set) => ({
            token: null,
            mailboxUser: null,
            isAuthenticated: false,

            setAuth: (token: string, mailboxUser: MailboxUser) => {
                localStorage.setItem('mailbox_token', token);
                set({
                    token,
                    mailboxUser,
                    isAuthenticated: true,
                });
            },

            clearAuth: () => {
                localStorage.removeItem('mailbox_token');
                localStorage.removeItem('mailbox_user');
                set({
                    token: null,
                    mailboxUser: null,
                    isAuthenticated: false,
                });
            },
        }),
        {
            name: 'mailbox-auth-storage',
            partialize: (state) => ({
                token: state.token,
                mailboxUser: state.mailboxUser,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);
