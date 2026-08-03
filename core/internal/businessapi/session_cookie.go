package businessapi

import "time"

const maxSessionCookieAgeSeconds = int64(1<<31 - 1)

func (s *Server) sessionCookieLifetime() (int, time.Time) {
	seconds := int64(1)
	now := time.Now()
	if s != nil {
		seconds = int64(s.cfg.JWTLifetime / time.Second)
		if s.now != nil {
			now = s.now()
		}
	}
	if seconds < 1 {
		seconds = 1
	}
	if seconds > maxSessionCookieAgeSeconds {
		seconds = maxSessionCookieAgeSeconds
	}
	return int(seconds), now.Add(time.Duration(seconds) * time.Second).UTC()
}
