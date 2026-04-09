#!/usr/bin/env python3
"""
Analyze GitHub Actions workflows across local repositories.

Run this against your organization's repositories to understand current
pipeline sprawl and measure platform action adoption before migrating
to CI/CD as a platform service.

Usage:
    python3 analyze_workflows.py /path/to/repos-root
    python3 analyze_workflows.py .  # scan subdirectories of current directory
"""

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class PipelineMetrics:
    """Metrics for a single repository's GitHub Actions workflows."""
    repo_name: str
    workflow_count: int
    total_lines: int
    uses_platform_actions: bool
    last_modified: datetime


def analyze_workflows(repo_path: Path) -> PipelineMetrics:
    """Analyze GitHub Actions workflows in a repository.

    Reads each workflow file once, reusing the content for both
    line counting and platform-action detection.
    """
    workflows_dir = repo_path / ".github" / "workflows"
    if not workflows_dir.exists():
        return PipelineMetrics(repo_path.name, 0, 0, False, datetime.now())

    # Support both .yml and .yaml — GitHub Actions accepts either extension.
    workflow_files = list(workflows_dir.glob("*.yml")) + list(workflows_dir.glob("*.yaml"))

    if not workflow_files:
        return PipelineMetrics(repo_path.name, 0, 0, False, datetime.now())

    # Read each file once and reuse the content for all calculations.
    contents = [f.read_text() for f in workflow_files]

    total_lines = sum(len(c.splitlines()) for c in contents)
    uses_platform = any("platform-org/platform-actions" in c for c in contents)
    latest_mod = max(f.stat().st_mtime for f in workflow_files)

    return PipelineMetrics(
        repo_name=repo_path.name,
        workflow_count=len(workflow_files),
        total_lines=total_lines,
        uses_platform_actions=uses_platform,
        last_modified=datetime.fromtimestamp(latest_mod),
    )


def calculate_adoption_rate(metrics: list[PipelineMetrics]) -> float:
    """Return the percentage of repos using platform actions."""
    if not metrics:
        return 0.0
    adopted = sum(1 for m in metrics if m.uses_platform_actions)
    return (adopted / len(metrics)) * 100


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Measure GitHub Actions pipeline sprawl and platform adoption."
    )
    parser.add_argument(
        "repos_root",
        type=Path,
        nargs="?",
        default=Path("."),
        help="Directory whose subdirectories are treated as repos (default: .)",
    )
    args = parser.parse_args()

    repos_root: Path = args.repos_root
    if not repos_root.is_dir():
        print(f"Error: {repos_root} is not a directory", file=sys.stderr)
        sys.exit(1)

    # Treat each immediate subdirectory as a repository.
    repo_paths = [p for p in sorted(repos_root.iterdir()) if p.is_dir()]
    if not repo_paths:
        print("No subdirectories found — pass a directory that contains repo folders.")
        sys.exit(0)

    metrics = [analyze_workflows(p) for p in repo_paths]
    adoption = calculate_adoption_rate(metrics)

    # Print summary table.
    header = f"{'Repo':<30} {'Workflows':>9} {'Lines':>7} {'Platform?':>10} {'Last Modified'}"
    print(header)
    print("-" * len(header))
    for m in metrics:
        platform_flag = "✓" if m.uses_platform_actions else "✗"
        print(
            f"{m.repo_name:<30} {m.workflow_count:>9} {m.total_lines:>7}"
            f" {platform_flag:>10}  {m.last_modified.strftime('%Y-%m-%d')}"
        )

    print()
    print(f"Total repos scanned : {len(metrics)}")
    print(f"Platform adoption   : {adoption:.1f}%")
    print(
        f"  ({sum(1 for m in metrics if m.uses_platform_actions)} of {len(metrics)} repos "
        f"use platform-org/platform-actions)"
    )


if __name__ == "__main__":
    main()
