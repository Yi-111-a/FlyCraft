# FlyCraft NPC 迭代计划 + Harness

## 目标（不可自欺）

把 FlyBot 做到 **类原版敌对 NPC** 水准（对标僵尸/尸壳）：
- 有目标就追
- 近战距离稳定挥砍（约 0.5–1.0s 冷却）
- 低血/受创会拉开
- 无目标时小范围游荡
- 不卡死、不乱飞、不被 Paper kick

**不是** Voyager 级智能，也不是全连接组端到端学习。MaleCNS 子图继续做高层 `fight/flee/wander` 动机；Mineflayer 做运动与攻击执行。

## 宣传钩子（先定调再拍）

主标题候选：
1. **「用果蝇大脑接线，驱动一个会打会逃的 Minecraft NPC」**
2. **「8000 个神经元节点 → 追击 / 近战 / 撤退」**
3. **「不是 LLM 写脚本，是连接组动力学在选动作」**

成片硬规则：
- 镜头只用 `/spectate FlyBot Viewer`（第一人称跟随 FlyBot）
- **画面里绝不能出现 Viewer 身体**
- 字幕标明：MaleCNS-derived subgraph controller（勿写意识上传）

## 验收 Harness（不过线不算完成）

脚本：`harness/npc_eval.js` + `scripts/run_npc_harness.sh`  
场景：永夜石台 16×16，刷 2 只 husk，跑 60s，导出 JSON。

| 指标 | 通过线 | 说明 |
|------|--------|------|
| `engage_ok` | ≥ 0.80 | 敌对进入 12 格后，10s 内进入 ≤3.5 格 |
| `melee_dps_ok` | ≥ 0.70 | 近战窗内攻击间隔中位数 ∈ [450, 1100] ms |
| `hits_landed` | ≥ 4 / 60s | 实际打中敌对（entityHurt 目标） |
| `flee_ok` | ≥ 0.70 | HP≤8 或 hurt 时，3s 内与敌对距离增大 ≥1.5 |
| `wander_ok` | ≥ 0.60 | 无敌对时 8s 位移 ≥2 且未掉出平台 |
| `stability_ok` | = 1 | 无 kick、无 NaN 坐标、全程在线 |
| **总分** | **≥ 0.75 且全部关键项通过** | `hits`+`stability` 为关键；其余加权 |

对照基线（诚实用）：
- 同场景刷一只原版 husk 打假目标，只作观感参考，不要求分数打平物理伤害。
- 若 FlyBot 只会聊天刷 `[fly] fight` 却追不上/打不中 → **判定失败**，继续迭代。

## 迭代环（每轮必须跑 harness）

1. 改代码（运动层 / 决策阈值 / 阈值）
2. `bash scripts/run_npc_harness.sh` → `harness/runs/run_N.json`
3. 读分数；失败则记下失败项，只改对应模块
4. 连续 **2 次** 总分≥0.75 才算达标
5. 达标后：旁观只跟 FlyBot 录 3 条宣传片（追击 / 近战特写 / 低血撤退）
6. 再开下一档优化（更稳寻路、多目标、更少手写 floor）

## 实现顺序

1. **运动**：恢复可用的 pathfinder（GoalNear / GoalFlee），失败回退 control-state；修 invalid move
2. **攻击**：冷却 ~650ms，进入 3.2 格才砍；持剑
3. **flee**：hurt 窗口缩短、低血才持续逃，避免永远 flee
4. **wander**：无目标时 GoalNear 随机点
5. **harness 自动化** → 达标 → 录片

## 明确不做（本阶段）

- 全图训练 / RL 通关
- 像素视觉
- 村民交易、建造
