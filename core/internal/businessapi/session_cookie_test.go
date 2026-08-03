package businessapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSessionCookiesMatchConfiguredJWTLifetime(t *testing.T) {
	server := testServer(&fakeStore{})
	server.cfg.JWTLifetime = 45 * time.Minute
	now := server.now()
	request := httptest.NewRequest(http.MethodGet, "https://mail.example.test/", nil)

	for name, setCookie := range map[string]func(http.ResponseWriter, *http.Request, string){
		adminSessionCookieName:   server.setAdminSessionCookie,
		mailboxSessionCookieName: server.setMailboxSessionCookie,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			setCookie(recorder, request, "signed-token")
			cookies := recorder.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("cookies = %#v", cookies)
			}
			cookie := cookies[0]
			if cookie.MaxAge != 45*60 {
				t.Fatalf("MaxAge = %d", cookie.MaxAge)
			}
			if cookie.Expires.Unix() != now.Add(45*time.Minute).Unix() {
				t.Fatalf("Expires = %s", cookie.Expires)
			}
			if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
				t.Fatalf("security attributes = %#v", cookie)
			}
		})
	}
}
