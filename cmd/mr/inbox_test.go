package main

import (
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

func TestCommentIDNum(t *testing.T) {
	cases := map[string]int{"c-001": 1, "c-042": 42, "c-008": 8, "x": -1, "": -1, "c-": -1}
	for in, want := range cases {
		if got := commentIDNum(in); got != want {
			t.Errorf("commentIDNum(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestCommentsSince(t *testing.T) {
	cs := []reviewstore.Comment{{ID: "c-006"}, {ID: "c-007"}, {ID: "c-008"}}
	got := commentsSince(cs, "c-006")
	if len(got) != 2 || got[0].ID != "c-007" || got[1].ID != "c-008" {
		t.Fatalf("commentsSince = %+v", got)
	}
	if len(commentsSince(cs, "c-008")) != 0 {
		t.Errorf("nothing should be after the last id")
	}
}

func TestUnansweredComments(t *testing.T) {
	cs := []reviewstore.Comment{
		{ID: "c-001"}, // no replies → unanswered
		{ID: "c-002", Replies: []reviewstore.Reply{{Author: "ai"}}},                       // ai answered
		{ID: "c-003", Replies: []reviewstore.Reply{{Author: "ai"}, {Author: "reviewer"}}}, // human follow-up → unanswered
		{ID: "c-004", Replies: []reviewstore.Reply{{Author: "reviewer"}, {Author: "ai"}}}, // ai answered last
	}
	got := unansweredComments(cs)
	ids := []string{}
	for _, c := range got {
		ids = append(ids, c.ID)
	}
	if len(ids) != 2 || ids[0] != "c-001" || ids[1] != "c-003" {
		t.Fatalf("unansweredComments ids = %v, want [c-001 c-003]", ids)
	}
}
