#!/bin/bash
# The deterministic scenarios (no LLM, no terminal emulation), one after the other.
cd "$(dirname "$0")"
status=0
for s in connect.sh ticket-thread.sh log.sh conflict.sh three-members.sh leave.sh approval.sh approval-tui.sh transcripts.sh ticket-tui.sh; do
  echo; echo "########## $s"
  bash "$s" || status=1
done
exit $status
