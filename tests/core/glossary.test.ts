import { describe, it, expect } from "vitest";
import {
  applyGlossary,
  restoreGlossary,
  glossaryPromptBlock,
  glossarySignature,
} from "../../src/core/glossary";

describe("applyGlossary", () => {
  it("空文本或空术语表原样返回，entities 为空", () => {
    expect(applyGlossary("", [{ src: "cat", dst: "猫" }])).toEqual({ text: "", entities: [] });
    expect(applyGlossary("hello", [])).toEqual({ text: "hello", entities: [] });
  });

  it("基本替换：术语变为 __GLOSSARY_n__，value 为 dst", () => {
    const r = applyGlossary("the cat sat", [{ src: "cat", dst: "猫" }]);
    expect(r.text).toBe("the __GLOSSARY_1__ sat");
    expect(r.entities).toEqual([{ serial: 1, value: "猫" }]);
  });

  it("边界感知：cat 不匹配 category（两端字母数字）", () => {
    const r = applyGlossary("I like category, not the cat.", [
      { src: "cat", dst: "猫" },
    ]);
    expect(r.text).toBe("I like category, not the __GLOSSARY_1__.");
    expect(r.entities).toHaveLength(1);
  });

  it("边界感知：不匹配 concatenate 内的 cat、数字内的 term", () => {
    const r = applyGlossary("concatenate and 12cat", [{ src: "cat", dst: "猫" }]);
    expect(r.text).toBe("concatenate and 12cat");
    expect(r.entities).toHaveLength(0);
  });

  it("边界感知：标点/空白/字符串首尾视为边界", () => {
    const r = applyGlossary("(cat), cat; 'cat'", [{ src: "cat", dst: "猫" }]);
    expect(r.text).toBe("(__GLOSSARY_1__), __GLOSSARY_2__; '__GLOSSARY_3__'");
    expect(r.entities).toHaveLength(3);
  });

  it("大小写不敏感：Server 命中 server，原文大小写保留在占位符替换中", () => {
    const r = applyGlossary("The Server is down", [{ src: "server", dst: "服务器" }]);
    expect(r.text).toBe("The __GLOSSARY_1__ is down");
  });

  it("重叠术语先长后短：machine learning 整体占位，learning 不再单独命中", () => {
    const r = applyGlossary("machine learning and learning", [
      { src: "learning", dst: "学习" },
      { src: "machine learning", dst: "机器学习" },
    ]);
    expect(r.text).toBe("__GLOSSARY_1__ and __GLOSSARY_2__");
    expect(r.entities).toEqual([
      { serial: 1, value: "机器学习" },
      { serial: 2, value: "学习" },
    ]);
  });

  it("先长后短与顺序无关：即使短术语排在前面也是长术语抢占", () => {
    const r = applyGlossary("machine learning", [
      { src: "machine", dst: "机器" },
      { src: "machine learning", dst: "机器学习" },
    ]);
    expect(r.text).toBe("__GLOSSARY_1__");
    expect(r.entities).toEqual([{ serial: 1, value: "机器学习" }]);
  });

  it("serial 按原文出现顺序分配（多个命中）", () => {
    const r = applyGlossary("cat and dog and cat", [
      { src: "cat", dst: "猫" },
      { src: "dog", dst: "狗" },
    ]);
    expect(r.text).toBe("__GLOSSARY_1__ and __GLOSSARY_2__ and __GLOSSARY_3__");
    expect(r.entities.map((e) => e.value)).toEqual(["猫", "狗", "猫"]);
  });

  it("从后往前替换：多命中时偏移不失效", () => {
    const terms = [{ src: "ab", dst: "X" }];
    const r = applyGlossary("ab ab ab ab", terms);
    expect(r.text).toBe("__GLOSSARY_1__ __GLOSSARY_2__ __GLOSSARY_3__ __GLOSSARY_4__");
  });

  it("正则特殊字符的 src 按字面匹配", () => {
    const r = applyGlossary("price is (c++)", [{ src: "(c++)", dst: "C++" }]);
    expect(r.text).toBe("price is __GLOSSARY_1__");
  });

  it("大小写不敏感去重：同 src 不同大小写只生效一次", () => {
    const r = applyGlossary("Cat cat", [
      { src: "Cat", dst: "猫" },
      { src: "cat", dst: "小猫" },
    ]);
    expect(r.text).toBe("__GLOSSARY_1__ __GLOSSARY_2__");
    expect(r.entities[0].value).toBe("猫"); // 先出现的条目优先
  });
});

describe("restoreGlossary", () => {
  const entities = [
    { serial: 1, value: "机器学习" },
    { serial: 2, value: "学习" },
    { serial: 11, value: "十一" },
  ];

  it("还原占位符为 dst 术语", () => {
    expect(restoreGlossary("__GLOSSARY_1__ 很难", entities)).toBe("机器学习 很难");
  });

  it("大小写容错：__glossary_1__ 也能还原", () => {
    expect(restoreGlossary("__glossary_1__", entities)).toBe("机器学习");
  });

  it("空格容错：下划线旁插空格也能还原", () => {
    expect(restoreGlossary("_ _ GLOSSARY_1_ _", entities)).toBe("机器学习");
  });

  it("尾部下划线丢失容错", () => {
    expect(restoreGlossary("__GLOSSARY_1", entities)).toBe("机器学习");
  });

  it("serial 降序：_11 不被 _1 误吞", () => {
    expect(restoreGlossary("__GLOSSARY_11__ 和 __GLOSSARY_1__", entities)).toBe(
      "十一 和 机器学习",
    );
  });

  it("value 含 $& 等特殊序列时按字面写回", () => {
    const r = applyGlossary("use cat", [{ src: "cat", dst: "$&尾巴" }]);
    expect(restoreGlossary(r.text, r.entities)).toBe("use $&尾巴");
  });

  it("缺失的占位符跳过，不影响其他还原", () => {
    expect(restoreGlossary("只有 __GLOSSARY_2__", entities)).toBe("只有 学习");
  });

  it("entities 为空或空文本原样返回", () => {
    expect(restoreGlossary("x", [])).toBe("x");
    expect(restoreGlossary("", entities)).toBe("");
  });
});

describe("applyGlossary + restoreGlossary 往返", () => {
  it("注入后译文含占位符可完整还原", () => {
    const terms = [
      { src: "machine learning", dst: "机器学习" },
      { src: "server", dst: "服务器" },
    ];
    const applied = applyGlossary("Server runs machine learning", terms);
    expect(applied.text).toBe("__GLOSSARY_1__ runs __GLOSSARY_2__");
    const translated = applied.text.replace("runs", "运行");
    expect(restoreGlossary(translated, applied.entities)).toBe("服务器 运行 机器学习");
  });
});

describe("glossaryPromptBlock", () => {
  it("每行 - src → dst", () => {
    const block = glossaryPromptBlock([
      { src: "Transformer", dst: "Transformer（变压器式模型）" },
      { src: "server", dst: "服务器" },
    ]);
    expect(block).toBe(
      "- Transformer → Transformer（变压器式模型）\n- server → 服务器",
    );
  });

  it("空表返回空串", () => {
    expect(glossaryPromptBlock([])).toBe("");
  });
});

describe("glossarySignature", () => {
  it("src=dst; 拼接，供缓存 key", () => {
    expect(
      glossarySignature([
        { src: "server", dst: "服务器" },
        { src: "cat", dst: "猫" },
      ]),
    ).toBe("server=服务器;cat=猫;");
  });

  it("空表返回空串", () => {
    expect(glossarySignature([])).toBe("");
  });
});
