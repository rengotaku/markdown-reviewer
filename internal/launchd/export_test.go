package launchd

// SetCheckPortFreeForTest swaps Install's port-in-use probe so flow tests
// don't depend on the host's real TCP state. It returns a restore func the
// caller must defer.
func SetCheckPortFreeForTest(f func(port string) error) (restore func()) {
	prev := checkPortFree
	checkPortFree = f
	return func() { checkPortFree = prev }
}
