package businessapi

import (
	"encoding/json"
	"errors"
)

// UnmarshalJSON makes permissions an explicit creation-time choice. Historical
// keys are backfilled to {"all":true}; newly created keys may not inherit the
// old implicit-all behavior by omitting this field.
func (request *createAPIKeyRequest) UnmarshalJSON(data []byte) error {
	type requestAlias createAPIKeyRequest
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	permissions, present := fields["permissions"]
	if !present || len(permissions) == 0 || isJSONNull(permissions) {
		return errors.New("permissions must be explicitly configured")
	}
	var decoded requestAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*request = createAPIKeyRequest(decoded)
	return nil
}
