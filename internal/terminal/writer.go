// Package terminal defines terminal input independently of any AI agent.
package terminal

import "context"

type Writer interface {
	WriteText(context.Context, string, string) error
}
