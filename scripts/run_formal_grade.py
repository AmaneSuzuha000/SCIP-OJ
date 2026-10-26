"""Run the frozen scorer with private server inputs; emit only public feedback."""
import json
import subprocess
from pathlib import Path

from judge.runner_l2_isolated import grade_file


def main():
    work = Path("_grading_tmp")
    context = json.loads((work / "context.json").read_text())
    settings = {**context["config"], "instance_seed": context["instance_seed"]}
    report = grade_file(work / "submission.py", settings["problem_id"], settings)
    image_id = subprocess.check_output(["docker", "image", "inspect", "scip-oj-student:ci",
                                        "--format", "{{.Id}}"], text=True).strip()
    report["execution"] = {"schema_version": 1, "grader_ref": settings["grader_ref"],
                           "scoring_policy_version": settings["scoring_policy_version"],
                           "code_hash": context["code_hash"], "image_id": image_id,
                           "pass_score": settings["pass_score"], "n_instances": settings["n_instances"]}
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    print("Formal grade:", report["status"], report.get("score"))


if __name__ == "__main__":
    main()
