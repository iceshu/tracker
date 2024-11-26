export class SessionManager {
    private static readonly SESSION_KEY = 'monitor_session_id';
    private static readonly SESSION_EXPIRY_KEY = 'monitor_session_expiry';
    private static readonly SESSION_TIMEOUT = 30 * 60 * 1000 * Infinity; //不过期

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
        const expiry = sessionStorage.getItem(this.SESSION_EXPIRY_KEY);

        if (!sessionId || !expiry) {
            return null;
        }

        // 检查session是否过期
        const expiryTime = parseInt(expiry, 10);
        if (Date.now() > expiryTime) {
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
        const expiryTime = Date.now() + this.SESSION_TIMEOUT;
        sessionStorage.setItem(this.SESSION_KEY, sessionId);
        sessionStorage.setItem(this.SESSION_EXPIRY_KEY, expiryTime.toString());
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