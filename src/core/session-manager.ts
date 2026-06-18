export class SessionManager {
    private static readonly SESSION_KEY = 'monitor_session_id';
    private static readonly SESSION_EXPIRY_KEY = 'monitor_session_expiry';
    // null 表示不过期（sessionStorage 在标签页关闭时本就会清除）；改为毫秒数即启用滑动过期
    private static readonly SESSION_TIMEOUT: number | null = null;

    /**
     * 获取或创建 sessionID
     * @returns string sessionID
     */
    public static getSessionId(): string {
        let sessionId = this.getExistingSessionId();

        if (!sessionId) {
            sessionId = this.createNewSession();
        } else {
            this.updateSessionExpiry();
        }

        return sessionId;
    }

    /**
     * 获取现有的 sessionID
     * @returns string | null
     */
    private static getExistingSessionId(): string | null {
        const sessionId = sessionStorage.getItem(this.SESSION_KEY);
        if (!sessionId) {
            return null;
        }
        if (this.SESSION_TIMEOUT == null) {
            return sessionId;
        }

        const expiry = sessionStorage.getItem(this.SESSION_EXPIRY_KEY);
        if (!expiry) {
            return null;
        }
        const expiryTime = parseInt(expiry, 10);
        if (Number.isNaN(expiryTime) || Date.now() > expiryTime) {
            this.clearSession();
            return null;
        }
        return sessionId;
    }

    /**
     * 创建新的 sessionID
     * @returns string
     */
    private static createNewSession(): string {
        const sessionId = this.generateSessionId();
        this.setSession(sessionId);
        return sessionId;
    }

    /**
     * 生成 sessionID
     * @returns string
     */
    private static generateSessionId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    /**
     * 设置 session 和过期时间
     * @param sessionId 
     */
    private static setSession(sessionId: string): void {
        sessionStorage.setItem(this.SESSION_KEY, sessionId);
        if (this.SESSION_TIMEOUT != null) {
            const expiryTime = Date.now() + this.SESSION_TIMEOUT;
            sessionStorage.setItem(this.SESSION_EXPIRY_KEY, expiryTime.toString());
        }
    }

    /**
     * 更新 session 过期时间
     */
    private static updateSessionExpiry(): void {
        const sessionId = sessionStorage.getItem(this.SESSION_KEY);
        if (sessionId) {
            this.setSession(sessionId);
        }
    }

    /**
     * 清除 session
     */
    private static clearSession(): void {
        sessionStorage.removeItem(this.SESSION_KEY);
        sessionStorage.removeItem(this.SESSION_EXPIRY_KEY);
    }
}