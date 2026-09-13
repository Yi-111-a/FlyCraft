# FlyCraft 一次性技术升级进度（本机 /workspace/flycraft）

**日期**: 2026-09-13  
**范围**: 仅本机，不碰中国 VPS。代码/权重保存在 `/workspace/flycraft`。  
**结论**: Opt1–Opt5 均已落地并有 git 里程碑提交；升级后 harness **通过**（`pass=true`, `score=0.977`）。轻量 RL **未保留**（相对基线无增益）。

---

## Git 里程碑

| Commit | 说明 |
|--------|------|
| `03fd40e` | `chore: baseline tree before technical upgrades` |
| `dc6f539` | `opt1(motion): robust control chase, stuck recovery, multi-threat flee path` |
| `e272551` | `opt2(decision): multi-target selection + fight→flee→re-engage machine` |
| `1d2086d` | `opt3(connectome): lower score floors + motor-edge ablation proof` |
| `f9d5405` | `opt4(perception): visibility, surrounding count, hurt direction` |
| `3badd9e` | `opt5(eval): multi-mob harness, no-resist survival, flee required` |
| `d5ab76b` | `docs+rl: ONE_SHOT_PROGRESS, discard RL (0.952<0.977), keep opt5 JSON` |

查看：`git -C /workspace/flycraft log --oneline`

---

## 升级后 Harness 分数（以 JSON 为准）

### 主评测 `harness/runs/run_opt5_base.json`

| 项 | 值 |
|----|----|
| pass | **true** |
| score | **0.977** |
| engage_rate | 1.0（trials=5） |
| melee_median_ms | 712 / melee_dps_ok=1 |
| hits_landed | 26（distinct_hit_ids=8） |
| flee_rate | **1.0**（trials=8, wins=8）— 已计入主分，无乐观默认 |
| survival_s | 59.48 / survival_ok=1（no-resist） |
| multi_mob_hit | 1.0 / multi_mob_presence=1 |
| stability_ok | 1（kicked=false；guarded NaN=33） |
| death_count | 3（无抗性下可接受） |

通过线（Opt5）：`score≥0.72` 且 `hits≥4` 且 `flee_trials≥1` 且 `flee_rate≥0.5` 且 `survival_ok≥0.4` 且 engage/melee 门槛。

### 对照：轻量 RL `harness/runs/run_opt5_rl.json`

| 项 | 值 |
|----|----|
| pass | true |
| score | **0.952**（< 基线 0.977） |
| flee_rate | 0.857 |
| 决策 | **丢弃** — 见 `artifacts/rl_bias.json`（`kept=false`） |

默认关闭：不设 `FLYCRAFT_RL=1` 时不加载 bias。

---

## Opt 摘要

### Opt1 运动
- 稳健 control-state 追击；`FLY_USE_PATHFINDER=1` 时仅远距低频 GoalNear。
- 卡住恢复：跳 / 侧移 / 后退循环。
- 多威胁合成逃跑向量 + 侧向偏置，靠边掺回中心。

### Opt2 决策
- 多目标打分（距离、粘性 id、高度差）。
- 状态机：`fight → flee → reengage → fight/wander`，含 `flee_min_ms` / `reengage_cooldown_ms`。

### Opt3 连接组
- 手写 floor 下调：`fight/flee/idle ≈ 0.15/0.18/0.08`。
- `FLYCRAFT_ABLATION=1` 敲掉 motor 入边；`artifacts/ablation_compare.json`：
  - ablated_edges ≈ **67795**
  - fight_score_drop ≈ **1.10**
  - fight_margin_drop ≈ **0.94**
  - `pass=true`（图读出确实有用）

### Opt4 感知
- 观测含 `visible` / `surrounding_count` / `hurt_dir` / `hostiles[]`。
- `SensoryEncoder.inject_perception` 偏置 `hostile_near` / `attack` 感觉池。
- telem 输出 `surrounding=`。

### Opt5 评测
- 3+ husk 多怪；可选 `HARNESS_ELEVATION=1`。
- 默认 `HARNESS_NO_RESIST=1`：主分可测 flee + survival。
- 中途 flee probe；**禁止**无 trial 时给乐观 flee 默认分。

---

## 产物路径

- 代码：`bridge-js/live_bot.js`, `flycraft/sim/live_server.py`, `flycraft/neural/encode.py`, `flycraft/rl/`
- 配置：`configs/malecns.yaml`, `configs/default.yaml`
- 消融：`artifacts/ablation_compare.json` + `scripts/run_ablation_compare.py`
- RL（已丢弃）：`artifacts/rl_bias.json`
- Harness：`harness/runs/run_opt5_base.json`, `harness/runs/run_opt5_rl.json`
- 脚本：`scripts/run_npc_harness.sh`

## 复现

```bash
cd /workspace/flycraft
bash scripts/run_npc_harness.sh opt5_recheck   # 主评测
python scripts/run_ablation_compare.py         # 连接组消融
# FLYCRAFT_RL=1 bash scripts/run_npc_harness.sh opt5_rl  # 仅对照，默认不启用
```

**诚实声明**：未宣称「通过」而无 JSON；Remotion/视频不在本子代理职责内。
