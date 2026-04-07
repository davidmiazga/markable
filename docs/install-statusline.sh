#!/bin/bash
# Claude Code Statusline Setup Script
#
# Usage: bash docs/install-statusline.sh
#
# This script automates the setup of the Claude Code statusline feature.
# It creates the statusline script, configures settings.json, and verifies the installation.

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Install it with: brew install jq"
    exit 1
fi
print_success "jq is installed"

if [ -z "$HOME" ]; then
    print_error "HOME environment variable is not set"
    exit 1
fi
print_success "HOME is set to $HOME"

# Create directories
mkdir -p ~/.claude 2>/dev/null || true

# Create the statusline script
print_info "Creating statusline script..."

cat > ~/.claude/statusline.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
# Claude Code Status Line Script with visual progress bars

input=$(cat)

# Debug: log input to see what Claude Code is sending
echo "[$(date '+%Y-%m-%d %H:%M:%S')] INPUT: $input" >> ~/.claude/statusline.log

# ANSI color codes
RED='\033[38;5;196m'
YELLOW='\033[38;5;226m'
GREEN='\033[38;5;46m'
BLUE='\033[38;5;27m'
RESET='\033[0m'

# Function to create a progress bar
make_bar() {
    local pct=$1
    local width=10
    local filled=$(printf '%.0f' $(echo "scale=0; $pct * $width / 100" | bc 2>/dev/null || echo 0))
    local empty=$((width - filled))

    # Determine color based on percentage
    local color="$GREEN"
    if [ "$pct" -gt 75 ]; then
        color="$RED"
    elif [ "$pct" -gt 50 ]; then
        color="$YELLOW"
    fi

    local filled_str=$(printf '█%.0s' $(seq 1 $filled))
    local empty_str=$(printf '░%.0s' $(seq 1 $empty))
    echo -n "${color}${filled_str}${empty_str}${RESET}"
}

# Extract fields
model=$(echo "$input" | jq -r '(try .model.display_name) // .model // "Claude"')
context=$(echo "$input" | jq -r '.context_window.remaining_percentage // ""')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // ""')
five_h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // ""')

# Calculate tokens used from context window data
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_output=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
tokens_used=$(echo "$total_input + $total_output" | bc 2>/dev/null || echo 0)
tokens_available=$(echo "$input" | jq -r '.context_window.context_window_size // ""')

# Build output string
output="${BLUE}${model}${RESET}"

# Add context bar if available
if [ -n "$context" ] && [ "$context" != "null" ]; then
    bar=$(make_bar "$context")
    output="$output ctx:${bar} $(printf '%.0f' "$context")%"
fi

# Add 5-hour rate limit bar if available
if [ -n "$five_h" ] && [ "$five_h" != "null" ]; then
    bar=$(make_bar "$five_h")
    output="$output | rate:${bar} $(printf '%.0f' "$five_h")%"
fi

# Add token usage if available
if [ -n "$tokens_used" ] && [ -n "$tokens_available" ] && [ "$tokens_used" != "null" ] && [ "$tokens_available" != "null" ]; then
    token_pct=$(echo "scale=0; $tokens_used * 100 / $tokens_available" | bc 2>/dev/null || echo 0)
    bar=$(make_bar "$token_pct")

    # Format token numbers (convert to M if > 1M)
    used_display=$(awk "BEGIN {if ($tokens_used >= 1000000) printf \"%.1fM\", $tokens_used/1000000; else printf \"%.0f\", $tokens_used}")
    avail_display=$(awk "BEGIN {if ($tokens_available >= 1000000) printf \"%.1fM\", $tokens_available/1000000; else printf \"%.0f\", $tokens_available}")

    output="$output | token:${bar} $(printf '%.0f' "$token_pct")% (${used_display}/${avail_display})"
fi

# Add directory and branch
if [ -n "$cwd" ] && [ "$cwd" != "null" ]; then
    display_dir=$(echo "$cwd" | sed "s|^$HOME|~|")
    output="$output | ${display_dir}"

    # Add git branch
    if [ -d "$cwd" ]; then
        branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
        if [ -n "$branch" ]; then
            output="$output [${branch}]"
        fi
    fi
fi

echo -e "$output"
SCRIPT_EOF

chmod +x ~/.claude/statusline.sh
print_success "Statusline script created at ~/.claude/statusline.sh"

# Initialize log file
touch ~/.claude/statusline.log
print_success "Log file created at ~/.claude/statusline.log"

# Update settings.json
print_info "Updating ~/.claude/settings.json..."

settings_file="$HOME/.claude/settings.json"

if [ ! -f "$settings_file" ]; then
    print_info "Creating new settings.json..."
    echo "{}" > "$settings_file"
fi

# Use jq to add/update the statusline configuration
if command -v jq &> /dev/null; then
    # Check if settings.json is valid JSON
    if ! jq empty "$settings_file" 2>/dev/null; then
        print_error "settings.json is not valid JSON. Please fix it manually."
        exit 1
    fi

    # Add statusline configuration
    jq --arg cmd "$HOME/.claude/statusline.sh" \
        '.statusline = {"type": "command", "command": $cmd}' \
        "$settings_file" > "$settings_file.tmp" && \
        mv "$settings_file.tmp" "$settings_file"

    print_success "Updated settings.json with statusline configuration"
else
    print_error "jq not found, cannot update settings.json automatically"
    echo "Please manually add this to ~/.claude/settings.json:"
    echo "  \"statusline\": {"
    echo "    \"type\": \"command\","
    echo "    \"command\": \"$HOME/.claude/statusline.sh\""
    echo "  }"
    exit 1
fi

# Verification
print_info "Verifying installation..."

if [ -x ~/.claude/statusline.sh ]; then
    print_success "Statusline script is executable"
else
    print_error "Statusline script is not executable"
    exit 1
fi

# Test the script with sample data
test_output=$(echo '{"model":"claude-opus-4-6","context_window":{"remaining_percentage":75,"total_input_tokens":1000,"total_output_tokens":500,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":25}},"workspace":{"current_dir":"'"$HOME"'"},"cost":{"total_cost_usd":0}}' | ~/.claude/statusline.sh)

if [ -n "$test_output" ]; then
    print_success "Script test successful"
    echo ""
    print_info "Sample output:"
    echo "  $test_output"
    echo ""
else
    print_error "Script test failed"
    exit 1
fi

# Final instructions
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Statusline setup complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to activate the statusline"
echo "  2. You should see the statusline at the bottom of the window"
echo ""
echo "If you don't see the statusline:"
echo "  - Check ~/.claude/statusline.log for debug information"
echo "  - Verify settings.json is valid JSON: jq empty ~/.claude/settings.json"
echo ""
echo "For more details, see: docs/STATUSLINE_SETUP.md"
echo ""
