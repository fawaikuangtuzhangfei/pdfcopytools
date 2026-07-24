import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflow, _internal } from '../src/reflow.js';

// 便捷构造：一行一个 item（y 向下增大）
const H = 12, LH = 18, LEFT = 100, RIGHT = 500;
function ln(str, y, { x = LEFT, w = RIGHT - LEFT, h = H } = {}) {
  return { str, x, y, width: w, height: h };
}

test('中文软折行：三行合并为一段，无多余空格', () => {
  const items = [
    ln('这是第一行内容占满整行到右边', LH),
    ln('第二行也占满到右边继续内容啊', LH * 2),
    ln('最后一行较短', LH * 3, { w: 100 }),
  ];
  assert.equal(
    reflow(items),
    '这是第一行内容占满整行到右边第二行也占满到右边继续内容啊最后一行较短',
  );
});

test('段落断：第二段首行缩进 → 拆成两段', () => {
  const items = [
    ln('甲段第一行填满右边到边界处内容', LH),
    ln('甲段第二行也填满右边界的内容啊', LH * 2),
    ln('乙段第一行有缩进从这里开始写的', LH * 3, { x: LEFT + 2 * H, w: RIGHT - (LEFT + 2 * H) }),
    ln('乙段第二行回到左边界继续写内容', LH * 4),
  ];
  assert.equal(
    reflow(items),
    '甲段第一行填满右边到边界处内容甲段第二行也填满右边界的内容啊\n' +
    '乙段第一行有缩进从这里开始写的乙段第二行回到左边界继续写内容',
  );
});

test('英文连字符换行：拼回单词，不留连字符', () => {
  const items = [
    ln('This is an inter-', LH, { w: 300 }),
    ln('national example of text', LH * 2, { w: 350 }),
  ];
  assert.equal(reflow(items), 'This is an international example of text');
});

test('英文跨行：拉丁词之间补空格', () => {
  const items = [
    ln('hello', LH, { w: 100 }),
    ln('world', LH * 2, { w: 100 }),
  ];
  assert.equal(reflow(items), 'hello world');
});

test('项目符号列表：两个要点各自成段', () => {
  const items = [
    ln('• 元数据列表所有已安装的名称与描述', LH),
    ln('注入到上下文的末尾外层用标签包裹', LH * 2),
    ln('• 完整内容则通过一个专用工具按需加载', LH * 3),
    ln('当模型识别出某个技能适合当前任务时', LH * 4),
  ];
  assert.equal(
    reflow(items),
    '• 元数据列表所有已安装的名称与描述注入到上下文的末尾外层用标签包裹\n' +
    '• 完整内容则通过一个专用工具按需加载当模型识别出某个技能适合当前任务时',
  );
});

test('行内多 item：拉丁词之间按间隙补空格', () => {
  const items = [
    { str: 'name', x: 100, y: LH, width: 40, height: H },
    { str: 'description', x: 170, y: LH, width: 100, height: H },
  ];
  assert.equal(reflow(items), 'name description');
});

test('行内多 item：CJK 之间不加空格', () => {
  const items = [
    { str: '元数据', x: 100, y: LH, width: 36, height: H },
    { str: '列表', x: 140, y: LH, width: 24, height: H },
  ];
  assert.equal(reflow(items), '元数据列表');
});

test('中英混排：默认边界不加空格', () => {
  const items = [
    { str: '调用', x: 100, y: LH, width: 24, height: H },
    { str: 'Skill', x: 124, y: LH, width: 40, height: H },
    { str: '工具', x: 164, y: LH, width: 24, height: H },
  ];
  assert.equal(reflow(items), '调用Skill工具');
});

test('大行间距 → 拆段', () => {
  const items = [
    ln('第一段填满右边界到边缘的内容文字', LH),
    ln('第二段和上面隔了很大的垂直间距啊', LH + 60),
  ];
  assert.equal(
    reflow(items),
    '第一段填满右边界到边缘的内容文字\n第二段和上面隔了很大的垂直间距啊',
  );
});

test('空输入返回空串', () => {
  assert.equal(reflow([]), '');
  assert.equal(reflow(null), '');
  assert.equal(reflow([{ str: '  ', x: 0, y: 0, width: 0, height: 0 }]), '');
});

test('cjkLatinSpace 选项：中英边界补空格', () => {
  const items = [
    { str: '调用', x: 100, y: LH, width: 24, height: H },
    { str: 'Skill', x: 124, y: LH, width: 40, height: H },
  ];
  assert.equal(reflow(items, { cjkLatinSpace: true }), '调用 Skill');
});

test('行内真实连字符保留（不误去连字符）', () => {
  const items = [
    { str: 'co-', x: 100, y: LH, width: 30, height: H },
    { str: 'operate', x: 132, y: LH, width: 70, height: H },
  ];
  assert.equal(reflow(items), 'co-operate');
});

test('数字编号列表：各项成段', () => {
  const items = [
    ln('1. 第一项内容填满右边界到边缘处啊', LH),
    ln('2. 第二项内容填满右边界到边缘处啊', LH * 2),
  ];
  assert.equal(
    reflow(items),
    '1. 第一项内容填满右边界到边缘处啊\n2. 第二项内容填满右边界到边缘处啊',
  );
});

test('行首小数不被误判为编号列表', () => {
  const items = [
    ln('上一行把整段填满一直到右边界处的内容', LH),
    ln('3.14 大约等于圆周率不应被当作列表项', LH * 2),
  ];
  // 两行应合并为一段（3.14 不是编号）
  assert.equal(
    reflow(items),
    '上一行把整段填满一直到右边界处的内容3.14 大约等于圆周率不应被当作列表项',
  );
});

test('_internal.groupLines 按 y 聚行', () => {
  const items = [
    { str: 'a', x: 100, y: 18, width: 10, height: H },
    { str: 'b', x: 120, y: 19, width: 10, height: H },
    { str: 'c', x: 100, y: 40, width: 10, height: H },
  ];
  const lines = _internal.groupLines(items, H);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].items.length, 2);
});
