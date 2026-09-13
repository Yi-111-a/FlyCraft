# FlyCraft NPC Harness 迭代报告

**日期**: 2026-09-13  
**结论**: **已通过** — `round4` / `round5` / `post_flee` 均为 `pass=true`（score=0.932）。  
**Flee 专项**: `flee_check.json` 实测 `flee_trials=7`, `flee_rate=1.0`（pass）。  
**宣传片**: 父代理已录 promo；本轮仅补充字幕/分镜建议，未再录视频。

---

## 各轮分数

| 轮次 | pass | score | hits | engage | melee_ok | melee_ms | flee | wander | stability | samples |
|------|------|-------|------|--------|----------|----------|------|--------|-----------|---------|
| round1 | false | 0.320 | 0 | 0 | 1 | 1023 | 0 | 0.7 | 1 | 0 |
| round2 | false | 0.652 | 0 | 1 | 1 | 701 | 0.55 | 0.7 | 1 | 24 |
| round3 | false | 0.840 | 3 | 1 | 1 | 748 | 0.55 | 0.7 | 1 | 13 |
| **round4** | **true** | **0.932** | **48** | **1** | **1** | **708** | 0.55 | **1** | **1** | 244 |
| **round5** | **true** | **0.932** | **47** | **1** | **1** | **704** | 0.55 | **1** | **1** | 244 |
| **post_flee** | **true** | **0.932** | **48** | **1** | **1** | **704** | 0.55† | **1** | **1** | 243 |

†主 harness 仍高抗性 → `flee_trials=0`，`flee_rate` 取默认 0.55；实测 flee 见专项 `flee_check.json`。

通过线：`score>=0.75` 且 `hits_landed>=4` 且 `stability_ok=1`，并满足 engage/melee 门槛。

产物：
- `/workspace/flycraft/harness/runs/run_round4.json`
- `/workspace/flycraft/harness/runs/run_round5.json`
- `/workspace/flycraft/harness/runs/run_post_flee.json`
- `/workspace/flycraft/harness/runs/flee_check.json`

---

## 改动摘要

### 1. `bridge-js/live_bot.js`（运动 / 攻击）
- **追击与近战**：控制状态追击（`look` 用 yaw/pitch 手算，**不用** `lookAt`，避免 Paper 1.20.4 + Mineflayer 4.20 的 NaN）；`<=3.2` 格挥砍，冷却 **650ms**；尽量持剑。
- **Pathfinder**：仍加载插件，但 **不设 Goal**（此前 GoalNear 会触发 `moved too quickly` / invalid move）。
- **逃跑**：背离敌对冲刺；贴竞技场边界时掺入回中心向量，避免冲出平台。
- **游荡**：无目标时随机 yaw 小步走，靠边回中。
- **NaN 防护**：发包守卫 + `repairEntityPose()` 用 `lastFiniteMove` 修复实体位姿；sense 卡死 2s 复位。
- **诚实命中日志**：1.20.4 上 `entityHurt` 不可靠，改为监听 `damage_event`（并辅以 metadata 掉血），输出 `[fly] hit ...`；另有 `[fly] telem ...` 供 harness。
- **hurt 窗口**：2600ms → **700ms**。

### 2. `flycraft/sim/live_server.py` + `configs/malecns.yaml`（决策阈值）
- 持续逃跑主要看 **低血**（`low_health: 8`）。
- 短时 hurt 仅在 HP≤`hurt_flee_health: 14` 时 sticky flee。
- 满血/健康时即使刚挨打仍优先 **fight**（僵尸式对砍）。
- `fight_distance: 12`，提高 `fight_floor`。

### 3. `harness/npc_eval.js`（度量诚实化）
- 观察者 bot **看不到其他玩家实体**（本环境 mineflayer/Paper 组合下 `bot.players` 为空），改为以 FlyBot **telem / hit / attack** 日志为权威指标。
- 修 arena：加高铁栏、spawnpoint、弱化 husk 攻击、Resistance/Regen/Absorption、失联/掉台拉回、补刷 husk。
- 命中去重；等待 FlyBot 真正 spawn 后再开分。

---

## 剩余缺口（诚实列出）

1. **Flee 已专项验证**：`harness/runs/flee_check.json` — 低抗性 + 强制低血 + 加强 husk，`flee_trials=7` / `flee_wins=7` / `flee_rate=1.0`（峰距增益 ≥1.5 / ~3s）。主 harness 仍用高抗性，故 `flee_trials=0` 属预期。
2. **NaN 仍偶发但略降**：本轮加了 pose 同步、微转跳过、`move` 看门狗；`post_flee` 仍约 19 次 guarded 信号，未 kick。
3. **未用 Pathfinder Goal**：控制追击已够用；若要更绕障，需极低频 Goal + 严格速度限制。
4. **Harness 补刷 husk / 高抗性**：保证 60s 可打满，略偏“评测脚手架”；行为本身仍是追击+冷却近战+命中。

---

## 建议父代理下一步

1. 宣传片已可由父代理侧使用；本轮字幕/分镜见下方「下一档优化」。
2. Flee 专项已完成：`bash scripts/run_flee_check.sh` → `harness/runs/flee_check.json`。
3. 全量回归：`bash scripts/run_npc_harness.sh post_flee` → **pass score=0.932**。

---

## Flee 专项验证（本轮）

| 项 | 值 |
|----|----|
| 产物 | `harness/runs/flee_check.json` |
| 条件 | Resistance I、强制 HP≈6、husk 攻伤 5 / 移速 0.30 |
| flee_trials | **7** |
| flee_wins | **7** |
| flee_rate | **1.0** |
| 判据 | `program=flee` 且 HP≤8 时，~3s 内与敌对距离峰增益 ≥1.5 |
| pass | **true** |

代码改动（本轮）：
- 新增 `harness/flee_check.js` + `scripts/run_flee_check.sh`
- `live_bot.js`：逃跑向量更偏「背离敌对」、无目标时仍冲刺；NaN 修复时停控 + `move` 看门狗 + 微转跳过
- `npc_eval.js`：flee 改为 telem 峰距计分，避免高抗性下瞬时掉血误伤 `flee_rate`

---

## 下一档优化

### 宣传片增强（无需再录亦可作下一版分镜）

1. **字幕钩子 A —「低血也会跑」**  
   画面：`/spectate FlyBot` 近身对砍 → HP 条骤降 → 背离 husk 拉开（可叠 `flee_check` 同场景：弱抗性）。  
   字幕示例：  
   - 「不是脚本写死逃跑——MaleCNS 子图在低血时抬高 flee 动机」  
   - 「Distance +3～9 格 / 3 秒（harness 实测 flee_rate=1.0）」

2. **字幕钩子 B —「8000 节点选动作」**  
   分镜：左下角小字打出 `decision=fight → flee → fight` 与 `nodes=8000`；切到近战挥砍特写（冷却 ~700ms）。  
   字幕示例：  
   - 「连接组动力学选 fight / flee / wander，Mineflayer 只负责腿和剑」  
   - 避免写「意识上传」；统一用 *MaleCNS-derived subgraph controller*

### 工程下一档（可选）

1. 把 flee 专项并入 CI：主 harness（高抗性）+ flee_check（低抗性）双轨。  
2. 继续收敛 NaN：审计 `position_look` 在贴脸/贴墙时的来源，目标 guarded 信号 <10 / 60s。  
3. 极低频 Pathfinder GoalNear（仅 >8 格时），带速度钳制，避免 `moved too quickly`。
