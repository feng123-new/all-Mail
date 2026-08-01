package businessapi

import (
	"time"

	"github.com/dlclark/regexp2/v2"
)

const (
	messageTextMatchTimeout      = 250 * time.Millisecond
	messageTextMaxBacktrackSlots = 100_000
)

func matchMessageText(content, pattern string, preferFirstCapture bool) (string, bool, error) {
	matcher, err := regexp2.Compile(
		pattern,
		regexp2.ECMAScript,
		regexp2.OptionMaxBacktrackingStackSize(messageTextMaxBacktrackSlots),
	)
	if err != nil {
		return "", false, err
	}
	matcher.MatchTimeout = messageTextMatchTimeout
	match, err := matcher.FindStringMatch(content)
	if err != nil {
		return "", false, err
	}
	if match == nil {
		return "", false, nil
	}
	if preferFirstCapture && match.GroupCount() > 1 {
		if captured := match.GroupByNumber(1); captured != nil && captured.String() != "" {
			return captured.String(), true, nil
		}
	}
	return match.String(), true, nil
}
