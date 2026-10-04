import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/ignore@7.0.10/node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/.pnpm/ignore@7.0.10/node_modules/ignore/index.js"(exports, module) {
    "use strict";
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
    var REGEX_TEST_BLANK_LINE = /^\uFEFF? *$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var DOUBLE_SLASH = "//";
    var SLASH_CODE = 47;
    var DOT_CODE = 46;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var RETURN_FALSE = () => false;
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var POSIX_CLASSES = {
      alnum: "0-9A-Za-z",
      alpha: "A-Za-z",
      blank: " \\t",
      cntrl: "\\x00-\\x1f\\x7f",
      digit: "0-9",
      graph: "!-.0-~",
      lower: "a-z",
      print: " -.0-~",
      punct: "!-.:-@\\[-`{-~",
      // git's `sane-ctype.h` classifies \v and \f as control, not space,
      //   unlike C's `isspace`
      space: " \\t\\n\\r",
      upper: "A-Z",
      xdigit: "0-9A-Fa-f"
    };
    var CLASS_MEMBERS_TO_ESCAPE = "\\]^-[";
    var escapeMember = (char) => CLASS_MEMBERS_TO_ESCAPE.indexOf(char) < 0 ? char : ESCAPE + char;
    var NON_SLASH = "(?!\\/)";
    var classSource = (negated, body) => {
      if (negated) {
        return `[^\\/${body}]`;
      }
      const source = `[${body}]`;
      return new RegExp(source).test("/") ? NON_SLASH + source : source;
    };
    var scanBracket = (pattern, start) => {
      const { length } = pattern;
      let index = start + 1;
      let negated = EMPTY;
      const lead = pattern[index];
      if (lead === "!" || lead === "^") {
        negated = "^";
        index++;
      }
      let body = EMPTY;
      let prev = EMPTY;
      for (; ; ) {
        const char = pattern[index];
        if (char === UNDEFINED) {
          return null;
        }
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === UNDEFINED) {
            return null;
          }
          body += escapeMember(escaped);
          prev = escaped;
          index++;
        } else if (char === "-" && prev && index + 1 < length && pattern[index + 1] !== "]") {
          index++;
          let to = pattern[index];
          if (to === ESCAPE) {
            to = pattern[index += 1];
          }
          if (prev <= to) {
            body += `-${escapeMember(to)}`;
          }
          prev = EMPTY;
        } else if (char === "[" && pattern[index + 1] === ":") {
          const nameStart = index + 2;
          let end = nameStart;
          while (end < length && pattern[end] !== "]") {
            end++;
          }
          if (end === length) {
            return null;
          }
          if (end > nameStart && pattern[end - 1] === ":") {
            const expanded = POSIX_CLASSES[pattern.slice(nameStart, end - 1)];
            if (expanded === UNDEFINED) {
              return null;
            }
            body += expanded;
            prev = EMPTY;
            index = end;
          } else {
            body += escapeMember("[");
            prev = "[";
            index = nameStart - 2;
          }
        } else {
          body += escapeMember(char);
          prev = char;
        }
        index++;
        if (pattern[index] === "]") {
          return {
            end: index,
            source: classSource(negated, body)
          };
        }
      }
    };
    var NEVER_MATCH = "[]";
    var PLACEHOLDER = "\0";
    var REGEX_RESTORE_PLACEHOLDER = new RegExp(
      `${PLACEHOLDER}(\\d+)${PLACEHOLDER}`,
      "g"
    );
    var TRAILING_WILDCARD = "\uE000";
    var extractBrackets = (pattern) => {
      const sources = [];
      const hold = (source) => `${PLACEHOLDER}${sources.push(source) - 1}${PLACEHOLDER}`;
      const { length } = pattern;
      let out = EMPTY;
      let index = 0;
      while (index < length) {
        const char = pattern[index];
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === "*" || escaped === "[" || escaped === SPACE || escaped === ESCAPE) {
            out += pattern.slice(index, index + 2);
          } else {
            out += hold(
              REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped
            );
          }
          index += 2;
        } else if (char === PLACEHOLDER) {
          out += hold(`[${PLACEHOLDER}]`);
          index++;
        } else if (char === "[") {
          const scanned = scanBracket(pattern, index);
          if (scanned === null) {
            out += hold(NEVER_MATCH);
            index = length;
          } else {
            out += hold(scanned.source);
            index = scanned.end + 1;
          }
        } else {
          out += char;
          index++;
        }
      }
      return {
        source: out,
        sources
      };
    };
    var DIRECT = null;
    var REGEX_INNER_SLASH = /\/(?!$)/;
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY,
        "\uFEFF"
      ],
      [
        // A trailing line terminator, left on when a whole file's contents are
        //   added as one pattern rather than split into lines. git never sees one
        //   -- it reads a `.gitignore` line by line -- so it is not part of the
        //   pattern and is dropped here, apart from the trailing-space trimming,
        //   which follows git in touching spaces and nothing else.
        /[\r\n]+$/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // Only spaces, never tabs or other whitespace: git trims a trailing run
        //   of `' '` and nothing else (dir.c, `trim_trailing_spaces`, a single
        //   `case ' '`), so a pattern ending in a tab keeps it as a literal.
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\? +)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // Only a space: an escaped tab or other whitespace is already a literal by
      //   the time it reaches here, and a bare tab must be left as one, not turned
      //   into a space.
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?) /g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]",
        "?"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^",
        SLASH
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/",
        SLASH
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*(?:\\\*\\\*\\\/)+/,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?",
        "*"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        DIRECT,
        (source, pattern) => {
          if (!source || source[0] === "^") {
            return source;
          }
          const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
          return anchor + source;
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? str.slice(index + 6) === "\\/" ? "(?:\\/[^\\/]+)+" : "(?:\\/[^\\/]+)*" : "\\/.+",
        "*"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        },
        "*"
      ],
      // trailing wildcard, held apart from a literal star
      [
        // The step above leaves a trailing `*` alone, so a single `\*` is all that
        //   can be left at the end here. Whether it is a wildcard or a literal
        //   turns on the backslashes the user put in front of it: the escaper has
        //   since doubled every one, so what stands here is those `2N` doubled
        //   backslashes and then the star's own escape. An even number of the
        //   original `N` leaves the star unescaped -- a wildcard -- and an odd
        //   number escapes it -- a literal. This runs while the two are still
        //   distinct, before the unescape steps below collapse the literal onto
        //   the very `\*` a wildcard leaves behind.
        /(^|[^\\])((?:\\\\)*)\\\*$/,
        (match, p1, p2) => (
          // `p2` holds the doubled user backslashes; half of them is `N`.
          p2.length / 2 % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match
        ),
        "*"
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // Every real bracket expression -- POSIX classes included -- has already
        //   been held aside by `extractBrackets`, so the only `[` left in the
        //   pattern is an escaped, literal one.
        // `\` is escaped by step 3
        /\\\[([^\]/]*?)(\\*)($|\])/g,
        // '\\[bar]' -> '\\\\[bar\\]'
        (match, range, endEscape, close) => `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`,
        "["
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        DIRECT,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (source) => {
          const last = source[source.length - 1];
          if (!last || last === TRAILING_WILDCARD) {
            return source;
          }
          return last === SLASH ? `${source}$` : `${source}(?=$|\\/$)`;
        }
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var WILDCARD = "[^\\/]*";
    var separatorAfter = (run, at) => {
      let separator = EMPTY;
      for (let index = at + 1; index < run.length && !run[index].wildcard; index++) {
        separator += run[index].single;
      }
      return separator;
    };
    var pinWildcards = (source) => {
      if (source.indexOf(WILDCARD) < 0) {
        return source;
      }
      const tokens = [];
      const { length } = source;
      let index = 0;
      while (index < length) {
        const char = source[index];
        if (source.startsWith(WILDCARD, index)) {
          tokens.push({ wildcard: true });
          index += WILDCARD.length;
        } else if (char === "[") {
          let end = index + 1;
          if (source[end] === "^") {
            end++;
          }
          if (source[end] === "]") {
            end++;
          }
          while (end < length && source[end] !== "]") {
            end += source[end] === ESCAPE ? 2 : 1;
          }
          end++;
          tokens.push({ single: source.slice(index, end) });
          index = end;
        } else if (char === ESCAPE) {
          tokens.push({ single: source.slice(index, index + 2) });
          index += 2;
        } else if (char === "(") {
          let depth = 0;
          let end = index;
          do {
            if (source[end] === ESCAPE) {
              end++;
            } else if (source[end] === "(") {
              depth++;
            } else if (source[end] === ")") {
              depth--;
            }
            end++;
          } while (end < length && depth > 0);
          if ("*+?".indexOf(source[end]) >= 0) {
            end++;
          }
          tokens.push({ boundary: source.slice(index, end) });
          index = end;
        } else if (char === "^" || char === "$") {
          tokens.push({ boundary: char });
          index++;
        } else {
          tokens.push({ single: char });
          index++;
        }
      }
      let out = EMPTY;
      let run = [];
      const flush = () => {
        let lastWildcard;
        run.forEach((token, at) => {
          if (token.wildcard) {
            lastWildcard = at;
          }
        });
        run.forEach((token, at) => {
          if (!token.wildcard) {
            out += token.single;
            return;
          }
          out += at === lastWildcard ? WILDCARD : `(?:(?!${separatorAfter(run, at)})[^\\/])*`;
        });
        run = [];
      };
      tokens.forEach((token) => {
        if (token.boundary === void 0) {
          run.push(token);
          return;
        }
        flush();
        out += token.boundary;
      });
      flush();
      return out;
    };
    var makeRegexPrefix = (pattern) => {
      const { source, sources } = extractBrackets(pattern);
      const replaced = REPLACERS.reduce(
        // A pass whose matcher finds nothing hands back the very string it was
        //   given, so asking first costs a search and saves a rewrite. Ten of the
        //   fifteen passes never fire for a typical .gitignore line, and between
        //   them they were 45% of this chain.
        (prev, [matcher, replacer, required]) => {
          if (matcher === DIRECT) {
            return replacer(prev, pattern);
          }
          if (required !== UNDEFINED && prev.indexOf(required) < 0) {
            return prev;
          }
          return matcher.test(prev) ? prev.replace(matcher, replacer.bind(pattern)) : prev;
        },
        source
      );
      return sources.length ? replaced.replace(
        REGEX_RESTORE_PLACEHOLDER,
        (match, index) => sources[index]
      ) : replaced;
    };
    var matchesBasename = (body) => {
      const index = body.indexOf(SLASH);
      return index < 0 || index === body.length - 1;
    };
    var basenameOf = (path) => {
      const end = path.length - 1;
      const index = path.lastIndexOf(
        SLASH,
        path[end] === SLASH ? end - 1 : end
      );
      return index < 0 ? path : path.slice(index + 1);
    };
    var parentOf = (path) => {
      if (path.charCodeAt(0) === SLASH_CODE || path.indexOf(DOUBLE_SLASH) >= 0) {
        const slices = path.split(SLASH).filter(Boolean);
        slices.pop();
        return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
      }
      const end = path.length - 1;
      const cut = path.lastIndexOf(
        SLASH,
        path.charCodeAt(end) === SLASH_CODE ? end - 1 : end
      );
      return cut < 0 ? EMPTY : path.slice(0, cut + 1);
    };
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      // Worked out on first use and kept behind an own property, the way `regex`
      //   caches itself in `_regex`. Deciding it in the constructor instead would
      //   add a fourth `defineProperty` to every rule ever built, which cost 4% of
      //   every compile -- including the compiles of rules that are never matched
      //   against anything.
      get _basenameOnly() {
        return define(this, "_basenameOnly", matchesBasename(this.body));
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = pinWildcards(this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        ));
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
        this._basenameCount = 0;
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._basenameCount += pattern._rules._basenameCount;
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
          if (matchesBasename(rule.body)) {
            this._basenameCount++;
          }
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        const rules = this._rules;
        const { length } = rules;
        const shortcut = this._basenameCount * 2 >= length;
        const basename2 = shortcut ? basenameOf(path) : path;
        for (let index = 0; index < length; index++) {
          const rule = rules[index];
          const { negative } = rule;
          const skip = unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored;
          if (!skip && rule[mode].test(
            shortcut && rule._basenameOnly ? basename2 : path
          )) {
            ignored = !negative;
            unignored = negative;
            matchedRule = negative ? UNDEFINED : rule;
          }
        }
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path, originalPath, doThrow) => {
      if (!isString(path)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path) => {
      const first = path.charCodeAt(0);
      if (first === SLASH_CODE) {
        return true;
      }
      if (first !== DOT_CODE) {
        return false;
      }
      if (path.length === 1) {
        return true;
      }
      const second = path.charCodeAt(1);
      if (second === SLASH_CODE) {
        return true;
      }
      if (second !== DOT_CODE) {
        return false;
      }
      return path.length === 2 || path.charCodeAt(2) === SLASH_CODE;
    };
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored) {
        const path = originalPath && checkPath.convert(originalPath);
        checkPath(
          path,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path, cache, checkUnignored);
      }
      checkIgnore(path) {
        if (path.charCodeAt(path.length - 1) !== SLASH_CODE) {
          return this.test(path);
        }
        const parentPath = parentOf(path);
        if (parentPath) {
          const parent = this._t(parentPath, this._testCache, true);
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path, false, MODE_CHECK_IGNORE);
      }
      _t(path, cache, checkUnignored) {
        if (path in cache) {
          return cache[path];
        }
        const parentPath = parentOf(path);
        const parent = parentPath ? this._t(parentPath, cache, checkUnignored) : UNDEFINED;
        return cache[path] = parent && parent.ignored ? parent : this._rules.test(path, checkUnignored, MODE_IGNORE);
      }
      ignores(path) {
        return this._test(path, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path) => !this.ignores(path);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path) {
        return this._test(path, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path) => checkPath(path && checkPath.convert(path), path, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path) || isNotRelative(path);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module.exports = factory;
    factory.default = factory;
    module.exports.isPathValid = isPathValid;
    define(module.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/utils.js
var require_utils = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/utils.js"(exports) {
    "use strict";
    exports.isInteger = (num) => {
      if (typeof num === "number") {
        return Number.isInteger(num);
      }
      if (typeof num === "string" && num.trim() !== "") {
        return Number.isInteger(Number(num));
      }
      return false;
    };
    exports.find = (node, type) => node.nodes.find((node2) => node2.type === type);
    exports.exceedsLimit = (min, max, step = 1, limit) => {
      if (limit === false) return false;
      if (!exports.isInteger(min) || !exports.isInteger(max)) return false;
      return (Number(max) - Number(min)) / Number(step) >= limit;
    };
    exports.escapeNode = (block, n = 0, type) => {
      const node = block.nodes[n];
      if (!node) return;
      if (type && node.type === type || node.type === "open" || node.type === "close") {
        if (node.escaped !== true) {
          node.value = "\\" + node.value;
          node.escaped = true;
        }
      }
    };
    exports.encloseBrace = (node) => {
      if (node.type !== "brace") return false;
      if (node.commas >> 0 + node.ranges >> 0 === 0) {
        node.invalid = true;
        return true;
      }
      return false;
    };
    exports.isInvalidBrace = (block) => {
      if (block.type !== "brace") return false;
      if (block.invalid === true || block.dollar) return true;
      if (block.commas >> 0 + block.ranges >> 0 === 0) {
        block.invalid = true;
        return true;
      }
      if (block.open !== true || block.close !== true) {
        block.invalid = true;
        return true;
      }
      return false;
    };
    exports.isOpenOrClose = (node) => {
      if (node.type === "open" || node.type === "close") {
        return true;
      }
      return node.open === true || node.close === true;
    };
    exports.reduce = (nodes) => nodes.reduce((acc, node) => {
      if (node.type === "text") acc.push(node.value);
      if (node.type === "range") node.type = "text";
      return acc;
    }, []);
    exports.flatten = (...args) => {
      const result = [];
      const flat = (arr) => {
        for (let i = 0; i < arr.length; i++) {
          const ele = arr[i];
          if (Array.isArray(ele)) {
            flat(ele);
            continue;
          }
          if (ele !== void 0) {
            result.push(ele);
          }
        }
        return result;
      };
      flat(args);
      return result;
    };
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/stringify.js"(exports, module) {
    "use strict";
    var utils = require_utils();
    module.exports = (ast, options = {}) => {
      const stringify = (node, parent = {}) => {
        const invalidBlock = options.escapeInvalid && utils.isInvalidBrace(parent);
        const invalidNode = node.invalid === true && options.escapeInvalid === true;
        let output = "";
        if (node.value) {
          if ((invalidBlock || invalidNode) && utils.isOpenOrClose(node)) {
            return "\\" + node.value;
          }
          return node.value;
        }
        if (node.value) {
          return node.value;
        }
        if (node.nodes) {
          for (const child of node.nodes) {
            output += stringify(child);
          }
        }
        return output;
      };
      return stringify(ast);
    };
  }
});

// node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js
var require_is_number = __commonJS({
  "node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js"(exports, module) {
    "use strict";
    module.exports = function(num) {
      if (typeof num === "number") {
        return num - num === 0;
      }
      if (typeof num === "string" && num.trim() !== "") {
        return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);
      }
      return false;
    };
  }
});

// node_modules/.pnpm/to-regex-range@5.0.1/node_modules/to-regex-range/index.js
var require_to_regex_range = __commonJS({
  "node_modules/.pnpm/to-regex-range@5.0.1/node_modules/to-regex-range/index.js"(exports, module) {
    "use strict";
    var isNumber = require_is_number();
    var toRegexRange = (min, max, options) => {
      if (isNumber(min) === false) {
        throw new TypeError("toRegexRange: expected the first argument to be a number");
      }
      if (max === void 0 || min === max) {
        return String(min);
      }
      if (isNumber(max) === false) {
        throw new TypeError("toRegexRange: expected the second argument to be a number.");
      }
      let opts = { relaxZeros: true, ...options };
      if (typeof opts.strictZeros === "boolean") {
        opts.relaxZeros = opts.strictZeros === false;
      }
      let relax = String(opts.relaxZeros);
      let shorthand = String(opts.shorthand);
      let capture = String(opts.capture);
      let wrap = String(opts.wrap);
      let cacheKey = min + ":" + max + "=" + relax + shorthand + capture + wrap;
      if (toRegexRange.cache.hasOwnProperty(cacheKey)) {
        return toRegexRange.cache[cacheKey].result;
      }
      let a = Math.min(min, max);
      let b = Math.max(min, max);
      if (Math.abs(a - b) === 1) {
        let result = min + "|" + max;
        if (opts.capture) {
          return `(${result})`;
        }
        if (opts.wrap === false) {
          return result;
        }
        return `(?:${result})`;
      }
      let isPadded = hasPadding(min) || hasPadding(max);
      let state = { min, max, a, b };
      let positives = [];
      let negatives = [];
      if (isPadded) {
        state.isPadded = isPadded;
        state.maxLen = String(state.max).length;
      }
      if (a < 0) {
        let newMin = b < 0 ? Math.abs(b) : 1;
        negatives = splitToPatterns(newMin, Math.abs(a), state, opts);
        a = state.a = 0;
      }
      if (b >= 0) {
        positives = splitToPatterns(a, b, state, opts);
      }
      state.negatives = negatives;
      state.positives = positives;
      state.result = collatePatterns(negatives, positives, opts);
      if (opts.capture === true) {
        state.result = `(${state.result})`;
      } else if (opts.wrap !== false && positives.length + negatives.length > 1) {
        state.result = `(?:${state.result})`;
      }
      toRegexRange.cache[cacheKey] = state;
      return state.result;
    };
    function collatePatterns(neg, pos, options) {
      let onlyNegative = filterPatterns(neg, pos, "-", false, options) || [];
      let onlyPositive = filterPatterns(pos, neg, "", false, options) || [];
      let intersected = filterPatterns(neg, pos, "-?", true, options) || [];
      let subpatterns = onlyNegative.concat(intersected).concat(onlyPositive);
      return subpatterns.join("|");
    }
    function splitToRanges(min, max) {
      let nines = 1;
      let zeros = 1;
      let stop = countNines(min, nines);
      let stops = /* @__PURE__ */ new Set([max]);
      while (min <= stop && stop <= max) {
        stops.add(stop);
        nines += 1;
        stop = countNines(min, nines);
      }
      stop = countZeros(max + 1, zeros) - 1;
      while (min < stop && stop <= max) {
        stops.add(stop);
        zeros += 1;
        stop = countZeros(max + 1, zeros) - 1;
      }
      stops = [...stops];
      stops.sort(compare);
      return stops;
    }
    function rangeToPattern(start, stop, options) {
      if (start === stop) {
        return { pattern: start, count: [], digits: 0 };
      }
      let zipped = zip(start, stop);
      let digits = zipped.length;
      let pattern = "";
      let count = 0;
      for (let i = 0; i < digits; i++) {
        let [startDigit, stopDigit] = zipped[i];
        if (startDigit === stopDigit) {
          pattern += startDigit;
        } else if (startDigit !== "0" || stopDigit !== "9") {
          pattern += toCharacterClass(startDigit, stopDigit, options);
        } else {
          count++;
        }
      }
      if (count) {
        pattern += options.shorthand === true ? "\\d" : "[0-9]";
      }
      return { pattern, count: [count], digits };
    }
    function splitToPatterns(min, max, tok, options) {
      let ranges = splitToRanges(min, max);
      let tokens = [];
      let start = min;
      let prev;
      for (let i = 0; i < ranges.length; i++) {
        let max2 = ranges[i];
        let obj = rangeToPattern(String(start), String(max2), options);
        let zeros = "";
        if (!tok.isPadded && prev && prev.pattern === obj.pattern) {
          if (prev.count.length > 1) {
            prev.count.pop();
          }
          prev.count.push(obj.count[0]);
          prev.string = prev.pattern + toQuantifier(prev.count);
          start = max2 + 1;
          continue;
        }
        if (tok.isPadded) {
          zeros = padZeros(max2, tok, options);
        }
        obj.string = zeros + obj.pattern + toQuantifier(obj.count);
        tokens.push(obj);
        start = max2 + 1;
        prev = obj;
      }
      return tokens;
    }
    function filterPatterns(arr, comparison, prefix, intersection, options) {
      let result = [];
      for (let ele of arr) {
        let { string } = ele;
        if (!intersection && !contains(comparison, "string", string)) {
          result.push(prefix + string);
        }
        if (intersection && contains(comparison, "string", string)) {
          result.push(prefix + string);
        }
      }
      return result;
    }
    function zip(a, b) {
      let arr = [];
      for (let i = 0; i < a.length; i++) arr.push([a[i], b[i]]);
      return arr;
    }
    function compare(a, b) {
      return a > b ? 1 : b > a ? -1 : 0;
    }
    function contains(arr, key, val) {
      return arr.some((ele) => ele[key] === val);
    }
    function countNines(min, len) {
      return Number(String(min).slice(0, -len) + "9".repeat(len));
    }
    function countZeros(integer, zeros) {
      return integer - integer % Math.pow(10, zeros);
    }
    function toQuantifier(digits) {
      let [start = 0, stop = ""] = digits;
      if (stop || start > 1) {
        return `{${start + (stop ? "," + stop : "")}}`;
      }
      return "";
    }
    function toCharacterClass(a, b, options) {
      return `[${a}${b - a === 1 ? "" : "-"}${b}]`;
    }
    function hasPadding(str) {
      return /^-?(0+)\d/.test(str);
    }
    function padZeros(value, tok, options) {
      if (!tok.isPadded) {
        return value;
      }
      let diff = Math.abs(tok.maxLen - String(value).length);
      let relax = options.relaxZeros !== false;
      switch (diff) {
        case 0:
          return "";
        case 1:
          return relax ? "0?" : "0";
        case 2:
          return relax ? "0{0,2}" : "00";
        default: {
          return relax ? `0{0,${diff}}` : `0{${diff}}`;
        }
      }
    }
    toRegexRange.cache = {};
    toRegexRange.clearCache = () => toRegexRange.cache = {};
    module.exports = toRegexRange;
  }
});

// node_modules/.pnpm/fill-range@7.1.1/node_modules/fill-range/index.js
var require_fill_range = __commonJS({
  "node_modules/.pnpm/fill-range@7.1.1/node_modules/fill-range/index.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var toRegexRange = require_to_regex_range();
    var isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    var transform = (toNumber) => {
      return (value) => toNumber === true ? Number(value) : String(value);
    };
    var isValidValue = (value) => {
      return typeof value === "number" || typeof value === "string" && value !== "";
    };
    var isNumber = (num) => Number.isInteger(+num);
    var zeros = (input) => {
      let value = `${input}`;
      let index = -1;
      if (value[0] === "-") value = value.slice(1);
      if (value === "0") return false;
      while (value[++index] === "0") ;
      return index > 0;
    };
    var stringify = (start, end, options) => {
      if (typeof start === "string" || typeof end === "string") {
        return true;
      }
      return options.stringify === true;
    };
    var pad = (input, maxLength, toNumber) => {
      if (maxLength > 0) {
        let dash = input[0] === "-" ? "-" : "";
        if (dash) input = input.slice(1);
        input = dash + input.padStart(dash ? maxLength - 1 : maxLength, "0");
      }
      if (toNumber === false) {
        return String(input);
      }
      return input;
    };
    var toMaxLen = (input, maxLength) => {
      let negative = input[0] === "-" ? "-" : "";
      if (negative) {
        input = input.slice(1);
        maxLength--;
      }
      while (input.length < maxLength) input = "0" + input;
      return negative ? "-" + input : input;
    };
    var toSequence = (parts, options, maxLen) => {
      parts.negatives.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      parts.positives.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      let prefix = options.capture ? "" : "?:";
      let positives = "";
      let negatives = "";
      let result;
      if (parts.positives.length) {
        positives = parts.positives.map((v) => toMaxLen(String(v), maxLen)).join("|");
      }
      if (parts.negatives.length) {
        negatives = `-(${prefix}${parts.negatives.map((v) => toMaxLen(String(v), maxLen)).join("|")})`;
      }
      if (positives && negatives) {
        result = `${positives}|${negatives}`;
      } else {
        result = positives || negatives;
      }
      if (options.wrap) {
        return `(${prefix}${result})`;
      }
      return result;
    };
    var toRange = (a, b, isNumbers, options) => {
      if (isNumbers) {
        return toRegexRange(a, b, { wrap: false, ...options });
      }
      let start = String.fromCharCode(a);
      if (a === b) return start;
      let stop = String.fromCharCode(b);
      return `[${start}-${stop}]`;
    };
    var toRegex = (start, end, options) => {
      if (Array.isArray(start)) {
        let wrap = options.wrap === true;
        let prefix = options.capture ? "" : "?:";
        return wrap ? `(${prefix}${start.join("|")})` : start.join("|");
      }
      return toRegexRange(start, end, options);
    };
    var rangeError = (...args) => {
      return new RangeError("Invalid range arguments: " + util.inspect(...args));
    };
    var invalidRange = (start, end, options) => {
      if (options.strictRanges === true) throw rangeError([start, end]);
      return [];
    };
    var invalidStep = (step, options) => {
      if (options.strictRanges === true) {
        throw new TypeError(`Expected step "${step}" to be a number`);
      }
      return [];
    };
    var fillNumbers = (start, end, step = 1, options = {}) => {
      let a = Number(start);
      let b = Number(end);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        if (options.strictRanges === true) throw rangeError([start, end]);
        return [];
      }
      if (a === 0) a = 0;
      if (b === 0) b = 0;
      let descending = a > b;
      let startString = String(start);
      let endString = String(end);
      let stepString = String(step);
      step = Math.max(Math.abs(step), 1);
      let padded = zeros(startString) || zeros(endString) || zeros(stepString);
      let maxLen = padded ? Math.max(startString.length, endString.length, stepString.length) : 0;
      let toNumber = padded === false && stringify(start, end, options) === false;
      let format = options.transform || transform(toNumber);
      if (options.toRegex && step === 1) {
        return toRange(toMaxLen(start, maxLen), toMaxLen(end, maxLen), true, options);
      }
      let parts = { negatives: [], positives: [] };
      let push = (num) => parts[num < 0 ? "negatives" : "positives"].push(Math.abs(num));
      let range = [];
      let index = 0;
      while (descending ? a >= b : a <= b) {
        if (options.toRegex === true && step > 1) {
          push(a);
        } else {
          range.push(pad(format(a, index), maxLen, toNumber));
        }
        a = descending ? a - step : a + step;
        index++;
      }
      if (options.toRegex === true) {
        return step > 1 ? toSequence(parts, options, maxLen) : toRegex(range, null, { wrap: false, ...options });
      }
      return range;
    };
    var fillLetters = (start, end, step = 1, options = {}) => {
      if (!isNumber(start) && start.length > 1 || !isNumber(end) && end.length > 1) {
        return invalidRange(start, end, options);
      }
      let format = options.transform || ((val) => String.fromCharCode(val));
      let a = `${start}`.charCodeAt(0);
      let b = `${end}`.charCodeAt(0);
      let descending = a > b;
      let min = Math.min(a, b);
      let max = Math.max(a, b);
      if (options.toRegex && step === 1) {
        return toRange(min, max, false, options);
      }
      let range = [];
      let index = 0;
      while (descending ? a >= b : a <= b) {
        range.push(format(a, index));
        a = descending ? a - step : a + step;
        index++;
      }
      if (options.toRegex === true) {
        return toRegex(range, null, { wrap: false, options });
      }
      return range;
    };
    var fill = (start, end, step, options = {}) => {
      if (end == null && isValidValue(start)) {
        return [start];
      }
      if (!isValidValue(start) || !isValidValue(end)) {
        return invalidRange(start, end, options);
      }
      if (typeof step === "function") {
        return fill(start, end, 1, { transform: step });
      }
      if (isObject(step)) {
        return fill(start, end, 0, step);
      }
      let opts = { ...options };
      if (opts.capture === true) opts.wrap = true;
      step = step || opts.step || 1;
      if (!isNumber(step)) {
        if (step != null && !isObject(step)) return invalidStep(step, opts);
        return fill(start, end, 1, step);
      }
      if (isNumber(start) && isNumber(end)) {
        return fillNumbers(start, end, step, opts);
      }
      return fillLetters(start, end, Math.max(Math.abs(step), 1), opts);
    };
    module.exports = fill;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/compile.js
var require_compile = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/compile.js"(exports, module) {
    "use strict";
    var fill = require_fill_range();
    var utils = require_utils();
    var compile = (ast, options = {}) => {
      const walk = (node, parent = {}) => {
        const invalidBlock = utils.isInvalidBrace(parent);
        const invalidNode = node.invalid === true && options.escapeInvalid === true;
        const invalid = invalidBlock === true || invalidNode === true;
        const prefix = options.escapeInvalid === true ? "\\" : "";
        let output = "";
        if (node.isOpen === true) {
          return prefix + node.value;
        }
        if (node.isClose === true) {
          console.log("node.isClose", prefix, node.value);
          return prefix + node.value;
        }
        if (node.type === "open") {
          return invalid ? prefix + node.value : "(";
        }
        if (node.type === "close") {
          return invalid ? prefix + node.value : ")";
        }
        if (node.type === "comma") {
          return node.prev.type === "comma" ? "" : invalid ? node.value : "|";
        }
        if (node.value) {
          return node.value;
        }
        if (node.nodes && node.ranges > 0) {
          const args = utils.reduce(node.nodes);
          const range = fill(...args, { ...options, wrap: false, toRegex: true, strictZeros: true });
          if (range.length !== 0) {
            return args.length > 1 && range.length > 1 ? `(${range})` : range;
          }
        }
        if (node.nodes) {
          for (const child of node.nodes) {
            output += walk(child, node);
          }
        }
        return output;
      };
      return walk(ast);
    };
    module.exports = compile;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/expand.js
var require_expand = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/expand.js"(exports, module) {
    "use strict";
    var fill = require_fill_range();
    var stringify = require_stringify();
    var utils = require_utils();
    var append = (queue = "", stash = "", enclose = false) => {
      const result = [];
      queue = [].concat(queue);
      stash = [].concat(stash);
      if (!stash.length) return queue;
      if (!queue.length) {
        return enclose ? utils.flatten(stash).map((ele) => `{${ele}}`) : stash;
      }
      for (const item of queue) {
        if (Array.isArray(item)) {
          for (const value of item) {
            result.push(append(value, stash, enclose));
          }
        } else {
          for (let ele of stash) {
            if (enclose === true && typeof ele === "string") ele = `{${ele}}`;
            result.push(Array.isArray(ele) ? append(item, ele, enclose) : item + ele);
          }
        }
      }
      return utils.flatten(result);
    };
    var expand = (ast, options = {}) => {
      const rangeLimit = options.rangeLimit === void 0 ? 1e3 : options.rangeLimit;
      const walk = (node, parent = {}) => {
        node.queue = [];
        let p = parent;
        let q = parent.queue;
        while (p.type !== "brace" && p.type !== "root" && p.parent) {
          p = p.parent;
          q = p.queue;
        }
        if (node.invalid || node.dollar) {
          q.push(append(q.pop(), stringify(node, options)));
          return;
        }
        if (node.type === "brace" && node.invalid !== true && node.nodes.length === 2) {
          q.push(append(q.pop(), ["{}"]));
          return;
        }
        if (node.nodes && node.ranges > 0) {
          const args = utils.reduce(node.nodes);
          if (utils.exceedsLimit(...args, options.step, rangeLimit)) {
            throw new RangeError("expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.");
          }
          let range = fill(...args, options);
          if (range.length === 0) {
            range = stringify(node, options);
          }
          q.push(append(q.pop(), range));
          node.nodes = [];
          return;
        }
        const enclose = utils.encloseBrace(node);
        let queue = node.queue;
        let block = node;
        while (block.type !== "brace" && block.type !== "root" && block.parent) {
          block = block.parent;
          queue = block.queue;
        }
        for (let i = 0; i < node.nodes.length; i++) {
          const child = node.nodes[i];
          if (child.type === "comma" && node.type === "brace") {
            if (i === 1) queue.push("");
            queue.push("");
            continue;
          }
          if (child.type === "close") {
            q.push(append(q.pop(), queue, enclose));
            continue;
          }
          if (child.value && child.type !== "open") {
            queue.push(append(queue.pop(), child.value));
            continue;
          }
          if (child.nodes) {
            walk(child, node);
          }
        }
        return queue;
      };
      return utils.flatten(walk(ast));
    };
    module.exports = expand;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/constants.js"(exports, module) {
    "use strict";
    module.exports = {
      MAX_LENGTH: 1e4,
      // Digits
      CHAR_0: "0",
      /* 0 */
      CHAR_9: "9",
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: "A",
      /* A */
      CHAR_LOWERCASE_A: "a",
      /* a */
      CHAR_UPPERCASE_Z: "Z",
      /* Z */
      CHAR_LOWERCASE_Z: "z",
      /* z */
      CHAR_LEFT_PARENTHESES: "(",
      /* ( */
      CHAR_RIGHT_PARENTHESES: ")",
      /* ) */
      CHAR_ASTERISK: "*",
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: "&",
      /* & */
      CHAR_AT: "@",
      /* @ */
      CHAR_BACKSLASH: "\\",
      /* \ */
      CHAR_BACKTICK: "`",
      /* ` */
      CHAR_CARRIAGE_RETURN: "\r",
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: "^",
      /* ^ */
      CHAR_COLON: ":",
      /* : */
      CHAR_COMMA: ",",
      /* , */
      CHAR_DOLLAR: "$",
      /* . */
      CHAR_DOT: ".",
      /* . */
      CHAR_DOUBLE_QUOTE: '"',
      /* " */
      CHAR_EQUAL: "=",
      /* = */
      CHAR_EXCLAMATION_MARK: "!",
      /* ! */
      CHAR_FORM_FEED: "\f",
      /* \f */
      CHAR_FORWARD_SLASH: "/",
      /* / */
      CHAR_HASH: "#",
      /* # */
      CHAR_HYPHEN_MINUS: "-",
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: "<",
      /* < */
      CHAR_LEFT_CURLY_BRACE: "{",
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: "[",
      /* [ */
      CHAR_LINE_FEED: "\n",
      /* \n */
      CHAR_NO_BREAK_SPACE: "\xA0",
      /* \u00A0 */
      CHAR_PERCENT: "%",
      /* % */
      CHAR_PLUS: "+",
      /* + */
      CHAR_QUESTION_MARK: "?",
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: ">",
      /* > */
      CHAR_RIGHT_CURLY_BRACE: "}",
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: "]",
      /* ] */
      CHAR_SEMICOLON: ";",
      /* ; */
      CHAR_SINGLE_QUOTE: "'",
      /* ' */
      CHAR_SPACE: " ",
      /*   */
      CHAR_TAB: "	",
      /* \t */
      CHAR_UNDERSCORE: "_",
      /* _ */
      CHAR_VERTICAL_LINE: "|",
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: "\uFEFF"
      /* \uFEFF */
    };
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/lib/parse.js"(exports, module) {
    "use strict";
    var stringify = require_stringify();
    var {
      MAX_LENGTH,
      CHAR_BACKSLASH,
      /* \ */
      CHAR_BACKTICK,
      /* ` */
      CHAR_COMMA,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_LEFT_SQUARE_BRACKET,
      /* [ */
      CHAR_RIGHT_SQUARE_BRACKET,
      /* ] */
      CHAR_DOUBLE_QUOTE,
      /* " */
      CHAR_SINGLE_QUOTE,
      /* ' */
      CHAR_NO_BREAK_SPACE,
      CHAR_ZERO_WIDTH_NOBREAK_SPACE
    } = require_constants();
    var parse = (input, options = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      const opts = options || {};
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      if (input.length > max) {
        throw new SyntaxError(`Input length (${input.length}), exceeds max characters (${max})`);
      }
      const ast = { type: "root", input, nodes: [] };
      const stack = [ast];
      let block = ast;
      let prev = ast;
      let brackets = 0;
      const length = input.length;
      let index = 0;
      let depth = 0;
      let value;
      const advance = () => input[index++];
      const push = (node) => {
        if (node.type === "text" && prev.type === "dot") {
          prev.type = "text";
        }
        if (prev && prev.type === "text" && node.type === "text") {
          prev.value += node.value;
          return;
        }
        block.nodes.push(node);
        node.parent = block;
        node.prev = prev;
        prev = node;
        return node;
      };
      push({ type: "bos" });
      while (index < length) {
        block = stack[stack.length - 1];
        value = advance();
        if (value === CHAR_ZERO_WIDTH_NOBREAK_SPACE || value === CHAR_NO_BREAK_SPACE) {
          continue;
        }
        if (value === CHAR_BACKSLASH) {
          push({ type: "text", value: (options.keepEscaping ? value : "") + advance() });
          continue;
        }
        if (value === CHAR_RIGHT_SQUARE_BRACKET) {
          push({ type: "text", value: "\\" + value });
          continue;
        }
        if (value === CHAR_LEFT_SQUARE_BRACKET) {
          brackets++;
          let next;
          while (index < length && (next = advance())) {
            value += next;
            if (next === CHAR_LEFT_SQUARE_BRACKET) {
              brackets++;
              continue;
            }
            if (next === CHAR_BACKSLASH) {
              value += advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET) {
              brackets--;
              if (brackets === 0) {
                break;
              }
            }
          }
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_LEFT_PARENTHESES) {
          block = push({ type: "paren", nodes: [] });
          stack.push(block);
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_RIGHT_PARENTHESES) {
          if (block.type !== "paren") {
            push({ type: "text", value });
            continue;
          }
          block = stack.pop();
          push({ type: "text", value });
          block = stack[stack.length - 1];
          continue;
        }
        if (value === CHAR_DOUBLE_QUOTE || value === CHAR_SINGLE_QUOTE || value === CHAR_BACKTICK) {
          const open = value;
          let next;
          if (options.keepQuotes !== true) {
            value = "";
          }
          while (index < length && (next = advance())) {
            if (next === CHAR_BACKSLASH) {
              value += next + advance();
              continue;
            }
            if (next === open) {
              if (options.keepQuotes === true) value += next;
              break;
            }
            value += next;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === CHAR_LEFT_CURLY_BRACE) {
          depth++;
          const dollar = prev.value && prev.value.slice(-1) === "$" || block.dollar === true;
          const brace = {
            type: "brace",
            open: true,
            close: false,
            dollar,
            depth,
            commas: 0,
            ranges: 0,
            nodes: []
          };
          block = push(brace);
          stack.push(block);
          push({ type: "open", value });
          continue;
        }
        if (value === CHAR_RIGHT_CURLY_BRACE) {
          if (block.type !== "brace") {
            push({ type: "text", value });
            continue;
          }
          const type = "close";
          block = stack.pop();
          block.close = true;
          push({ type, value });
          depth--;
          block = stack[stack.length - 1];
          continue;
        }
        if (value === CHAR_COMMA && depth > 0) {
          if (block.ranges > 0) {
            block.ranges = 0;
            const open = block.nodes.shift();
            block.nodes = [open, { type: "text", value: stringify(block) }];
          }
          push({ type: "comma", value });
          block.commas++;
          continue;
        }
        if (value === CHAR_DOT && depth > 0 && block.commas === 0) {
          const siblings = block.nodes;
          if (depth === 0 || siblings.length === 0) {
            push({ type: "text", value });
            continue;
          }
          if (prev.type === "dot") {
            block.range = [];
            prev.value += value;
            prev.type = "range";
            if (block.nodes.length !== 3 && block.nodes.length !== 5) {
              block.invalid = true;
              block.ranges = 0;
              prev.type = "text";
              continue;
            }
            block.ranges++;
            block.args = [];
            continue;
          }
          if (prev.type === "range") {
            siblings.pop();
            const before = siblings[siblings.length - 1];
            before.value += prev.value + value;
            prev = before;
            block.ranges--;
            continue;
          }
          push({ type: "dot", value });
          continue;
        }
        push({ type: "text", value });
      }
      do {
        block = stack.pop();
        if (block.type !== "root") {
          block.nodes.forEach((node) => {
            if (!node.nodes) {
              if (node.type === "open") node.isOpen = true;
              if (node.type === "close") node.isClose = true;
              if (!node.nodes) node.type = "text";
              node.invalid = true;
            }
          });
          const parent = stack[stack.length - 1];
          const index2 = parent.nodes.indexOf(block);
          parent.nodes.splice(index2, 1, ...block.nodes);
        }
      } while (stack.length > 0);
      push({ type: "eos" });
      return ast;
    };
    module.exports = parse;
  }
});

// node_modules/.pnpm/braces@3.0.3/node_modules/braces/index.js
var require_braces = __commonJS({
  "node_modules/.pnpm/braces@3.0.3/node_modules/braces/index.js"(exports, module) {
    "use strict";
    var stringify = require_stringify();
    var compile = require_compile();
    var expand = require_expand();
    var parse = require_parse();
    var braces = (input, options = {}) => {
      let output = [];
      if (Array.isArray(input)) {
        for (const pattern of input) {
          const result = braces.create(pattern, options);
          if (Array.isArray(result)) {
            output.push(...result);
          } else {
            output.push(result);
          }
        }
      } else {
        output = [].concat(braces.create(input, options));
      }
      if (options && options.expand === true && options.nodupes === true) {
        output = [...new Set(output)];
      }
      return output;
    };
    braces.parse = (input, options = {}) => parse(input, options);
    braces.stringify = (input, options = {}) => {
      if (typeof input === "string") {
        return stringify(braces.parse(input, options), options);
      }
      return stringify(input, options);
    };
    braces.compile = (input, options = {}) => {
      if (typeof input === "string") {
        input = braces.parse(input, options);
      }
      return compile(input, options);
    };
    braces.expand = (input, options = {}) => {
      if (typeof input === "string") {
        input = braces.parse(input, options);
      }
      let result = expand(input, options);
      if (options.noempty === true) {
        result = result.filter(Boolean);
      }
      if (options.nodupes === true) {
        result = [...new Set(result)];
      }
      return result;
    };
    braces.create = (input, options = {}) => {
      if (input === "" || input.length < 3) {
        return [input];
      }
      return options.expand !== true ? braces.compile(input, options) : braces.expand(input, options);
    };
    module.exports = braces;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/constants.js
var require_constants2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/constants.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var WIN_SLASH = "\\\\/";
    var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
    var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
    var DOT_LITERAL = "\\.";
    var PLUS_LITERAL = "\\+";
    var QMARK_LITERAL = "\\?";
    var SLASH_LITERAL = "\\/";
    var ONE_CHAR = "(?=.)";
    var QMARK = "[^/]";
    var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
    var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
    var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
    var NO_DOT = `(?!${DOT_LITERAL})`;
    var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
    var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
    var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
    var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
    var STAR = `${QMARK}*?`;
    var POSIX_CHARS = {
      DOT_LITERAL,
      PLUS_LITERAL,
      QMARK_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      QMARK,
      END_ANCHOR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR
    };
    var WINDOWS_CHARS = {
      ...POSIX_CHARS,
      SLASH_LITERAL: `[${WIN_SLASH}]`,
      QMARK: WIN_NO_SLASH,
      STAR: `${WIN_NO_SLASH}*?`,
      DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
      NO_DOT: `(?!${DOT_LITERAL})`,
      NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
      NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
      QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
      START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
      END_ANCHOR: `(?:[${WIN_SLASH}]|$)`
    };
    var POSIX_REGEX_SOURCE = {
      __proto__: null,
      alnum: "a-zA-Z0-9",
      alpha: "a-zA-Z",
      ascii: "\\x00-\\x7F",
      blank: " \\t",
      cntrl: "\\x00-\\x1F\\x7F",
      digit: "0-9",
      graph: "\\x21-\\x7E",
      lower: "a-z",
      print: "\\x20-\\x7E ",
      punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
      space: " \\t\\r\\n\\v\\f",
      upper: "A-Z",
      word: "A-Za-z0-9_",
      xdigit: "A-Fa-f0-9"
    };
    module.exports = {
      DEFAULT_MAX_EXTGLOB_RECURSION,
      MAX_LENGTH: 1024 * 64,
      POSIX_REGEX_SOURCE,
      // regular expressions
      REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
      REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
      REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
      REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
      REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
      REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
      // Replace globs with equivalent patterns to reduce parsing time.
      REPLACEMENTS: {
        __proto__: null,
        "***": "*",
        "**/**": "**",
        "**/**/**": "**"
      },
      // Digits
      CHAR_0: 48,
      /* 0 */
      CHAR_9: 57,
      /* 9 */
      // Alphabet chars.
      CHAR_UPPERCASE_A: 65,
      /* A */
      CHAR_LOWERCASE_A: 97,
      /* a */
      CHAR_UPPERCASE_Z: 90,
      /* Z */
      CHAR_LOWERCASE_Z: 122,
      /* z */
      CHAR_LEFT_PARENTHESES: 40,
      /* ( */
      CHAR_RIGHT_PARENTHESES: 41,
      /* ) */
      CHAR_ASTERISK: 42,
      /* * */
      // Non-alphabetic chars.
      CHAR_AMPERSAND: 38,
      /* & */
      CHAR_AT: 64,
      /* @ */
      CHAR_BACKWARD_SLASH: 92,
      /* \ */
      CHAR_CARRIAGE_RETURN: 13,
      /* \r */
      CHAR_CIRCUMFLEX_ACCENT: 94,
      /* ^ */
      CHAR_COLON: 58,
      /* : */
      CHAR_COMMA: 44,
      /* , */
      CHAR_DOT: 46,
      /* . */
      CHAR_DOUBLE_QUOTE: 34,
      /* " */
      CHAR_EQUAL: 61,
      /* = */
      CHAR_EXCLAMATION_MARK: 33,
      /* ! */
      CHAR_FORM_FEED: 12,
      /* \f */
      CHAR_FORWARD_SLASH: 47,
      /* / */
      CHAR_GRAVE_ACCENT: 96,
      /* ` */
      CHAR_HASH: 35,
      /* # */
      CHAR_HYPHEN_MINUS: 45,
      /* - */
      CHAR_LEFT_ANGLE_BRACKET: 60,
      /* < */
      CHAR_LEFT_CURLY_BRACE: 123,
      /* { */
      CHAR_LEFT_SQUARE_BRACKET: 91,
      /* [ */
      CHAR_LINE_FEED: 10,
      /* \n */
      CHAR_NO_BREAK_SPACE: 160,
      /* \u00A0 */
      CHAR_PERCENT: 37,
      /* % */
      CHAR_PLUS: 43,
      /* + */
      CHAR_QUESTION_MARK: 63,
      /* ? */
      CHAR_RIGHT_ANGLE_BRACKET: 62,
      /* > */
      CHAR_RIGHT_CURLY_BRACE: 125,
      /* } */
      CHAR_RIGHT_SQUARE_BRACKET: 93,
      /* ] */
      CHAR_SEMICOLON: 59,
      /* ; */
      CHAR_SINGLE_QUOTE: 39,
      /* ' */
      CHAR_SPACE: 32,
      /*   */
      CHAR_TAB: 9,
      /* \t */
      CHAR_UNDERSCORE: 95,
      /* _ */
      CHAR_VERTICAL_LINE: 124,
      /* | */
      CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
      /* \uFEFF */
      SEP: path.sep,
      /**
       * Create EXTGLOB_CHARS
       */
      extglobChars(chars) {
        return {
          "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
          "?": { type: "qmark", open: "(?:", close: ")?" },
          "+": { type: "plus", open: "(?:", close: ")+" },
          "*": { type: "star", open: "(?:", close: ")*" },
          "@": { type: "at", open: "(?:", close: ")" }
        };
      },
      /**
       * Create GLOB_CHARS
       */
      globChars(win32) {
        return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
      }
    };
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/utils.js
var require_utils2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/utils.js"(exports) {
    "use strict";
    var path = __require("path");
    var win32 = process.platform === "win32";
    var {
      REGEX_BACKSLASH,
      REGEX_REMOVE_BACKSLASH,
      REGEX_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_GLOBAL
    } = require_constants2();
    exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
    exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
    exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
    exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
    exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
    exports.removeBackslashes = (str) => {
      return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
        return match === "\\" ? "" : match;
      });
    };
    exports.supportsLookbehinds = () => {
      const segs = process.version.slice(1).split(".").map(Number);
      if (segs.length === 3 && segs[0] >= 9 || segs[0] === 8 && segs[1] >= 10) {
        return true;
      }
      return false;
    };
    exports.isWindows = (options) => {
      if (options && typeof options.windows === "boolean") {
        return options.windows;
      }
      return win32 === true || path.sep === "\\";
    };
    exports.escapeLast = (input, char, lastIdx) => {
      const idx = input.lastIndexOf(char, lastIdx);
      if (idx === -1) return input;
      if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
      return `${input.slice(0, idx)}\\${input.slice(idx)}`;
    };
    exports.removePrefix = (input, state = {}) => {
      let output = input;
      if (output.startsWith("./")) {
        output = output.slice(2);
        state.prefix = "./";
      }
      return output;
    };
    exports.wrapOutput = (input, state = {}, options = {}) => {
      const prepend = options.contains ? "" : "^";
      const append = options.contains ? "" : "$";
      let output = `${prepend}(?:${input})${append}`;
      if (state.negated === true) {
        output = `(?:^(?!${output}).*$)`;
      }
      return output;
    };
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/scan.js"(exports, module) {
    "use strict";
    var utils = require_utils2();
    var {
      CHAR_ASTERISK,
      /* * */
      CHAR_AT,
      /* @ */
      CHAR_BACKWARD_SLASH,
      /* \ */
      CHAR_COMMA,
      /* , */
      CHAR_DOT,
      /* . */
      CHAR_EXCLAMATION_MARK,
      /* ! */
      CHAR_FORWARD_SLASH,
      /* / */
      CHAR_LEFT_CURLY_BRACE,
      /* { */
      CHAR_LEFT_PARENTHESES,
      /* ( */
      CHAR_LEFT_SQUARE_BRACKET,
      /* [ */
      CHAR_PLUS,
      /* + */
      CHAR_QUESTION_MARK,
      /* ? */
      CHAR_RIGHT_CURLY_BRACE,
      /* } */
      CHAR_RIGHT_PARENTHESES,
      /* ) */
      CHAR_RIGHT_SQUARE_BRACKET
      /* ] */
    } = require_constants2();
    var isPathSeparator = (code) => {
      return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
    };
    var depth = (token) => {
      if (token.isPrefix !== true) {
        token.depth = token.isGlobstar ? Infinity : 1;
      }
    };
    var scan = (input, options) => {
      const opts = options || {};
      const length = input.length - 1;
      const scanToEnd = opts.parts === true || opts.scanToEnd === true;
      const slashes = [];
      const tokens = [];
      const parts = [];
      let str = input;
      let index = -1;
      let start = 0;
      let lastIndex = 0;
      let isBrace = false;
      let isBracket = false;
      let isGlob = false;
      let isExtglob = false;
      let isGlobstar = false;
      let braceEscaped = false;
      let backslashes = false;
      let negated = false;
      let negatedExtglob = false;
      let finished = false;
      let braces = 0;
      let prev;
      let code;
      let token = { value: "", depth: 0, isGlob: false };
      const eos = () => index >= length;
      const peek = () => str.charCodeAt(index + 1);
      const advance = () => {
        prev = code;
        return str.charCodeAt(++index);
      };
      while (index < length) {
        code = advance();
        let next;
        if (code === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          code = advance();
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braceEscaped = true;
          }
          continue;
        }
        if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
          braces++;
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (code === CHAR_LEFT_CURLY_BRACE) {
              braces++;
              continue;
            }
            if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (braceEscaped !== true && code === CHAR_COMMA) {
              isBrace = token.isBrace = true;
              isGlob = token.isGlob = true;
              finished = true;
              if (scanToEnd === true) {
                continue;
              }
              break;
            }
            if (code === CHAR_RIGHT_CURLY_BRACE) {
              braces--;
              if (braces === 0) {
                braceEscaped = false;
                isBrace = token.isBrace = true;
                finished = true;
                break;
              }
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_FORWARD_SLASH) {
          slashes.push(index);
          tokens.push(token);
          token = { value: "", depth: 0, isGlob: false };
          if (finished === true) continue;
          if (prev === CHAR_DOT && index === start + 1) {
            start += 2;
            continue;
          }
          lastIndex = index + 1;
          continue;
        }
        if (opts.noext !== true) {
          const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
          if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
            isGlob = token.isGlob = true;
            isExtglob = token.isExtglob = true;
            finished = true;
            if (code === CHAR_EXCLAMATION_MARK && index === start) {
              negatedExtglob = true;
            }
            if (scanToEnd === true) {
              while (eos() !== true && (code = advance())) {
                if (code === CHAR_BACKWARD_SLASH) {
                  backslashes = token.backslashes = true;
                  code = advance();
                  continue;
                }
                if (code === CHAR_RIGHT_PARENTHESES) {
                  isGlob = token.isGlob = true;
                  finished = true;
                  break;
                }
              }
              continue;
            }
            break;
          }
        }
        if (code === CHAR_ASTERISK) {
          if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_QUESTION_MARK) {
          isGlob = token.isGlob = true;
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (code === CHAR_LEFT_SQUARE_BRACKET) {
          while (eos() !== true && (next = advance())) {
            if (next === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (next === CHAR_RIGHT_SQUARE_BRACKET) {
              isBracket = token.isBracket = true;
              isGlob = token.isGlob = true;
              finished = true;
              break;
            }
          }
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
        if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
          negated = token.negated = true;
          start++;
          continue;
        }
        if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_LEFT_PARENTHESES) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES) {
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
        if (isGlob === true) {
          finished = true;
          if (scanToEnd === true) {
            continue;
          }
          break;
        }
      }
      if (opts.noext === true) {
        isExtglob = false;
        isGlob = false;
      }
      let base = str;
      let prefix = "";
      let glob = "";
      if (start > 0) {
        prefix = str.slice(0, start);
        str = str.slice(start);
        lastIndex -= start;
      }
      if (base && isGlob === true && lastIndex > 0) {
        base = str.slice(0, lastIndex);
        glob = str.slice(lastIndex);
      } else if (isGlob === true) {
        base = "";
        glob = str;
      } else {
        base = str;
      }
      if (base && base !== "" && base !== "/" && base !== str) {
        if (isPathSeparator(base.charCodeAt(base.length - 1))) {
          base = base.slice(0, -1);
        }
      }
      if (opts.unescape === true) {
        if (glob) glob = utils.removeBackslashes(glob);
        if (base && backslashes === true) {
          base = utils.removeBackslashes(base);
        }
      }
      const state = {
        prefix,
        input,
        start,
        base,
        glob,
        isBrace,
        isBracket,
        isGlob,
        isExtglob,
        isGlobstar,
        negated,
        negatedExtglob
      };
      if (opts.tokens === true) {
        state.maxDepth = 0;
        if (!isPathSeparator(code)) {
          tokens.push(token);
        }
        state.tokens = tokens;
      }
      if (opts.parts === true || opts.tokens === true) {
        let prevIndex;
        for (let idx = 0; idx < slashes.length; idx++) {
          const n = prevIndex ? prevIndex + 1 : start;
          const i = slashes[idx];
          const value = input.slice(n, i);
          if (opts.tokens) {
            if (idx === 0 && start !== 0) {
              tokens[idx].isPrefix = true;
              tokens[idx].value = prefix;
            } else {
              tokens[idx].value = value;
            }
            depth(tokens[idx]);
            state.maxDepth += tokens[idx].depth;
          }
          if (idx !== 0 || value !== "") {
            parts.push(value);
          }
          prevIndex = i;
        }
        if (prevIndex && prevIndex + 1 < input.length) {
          const value = input.slice(prevIndex + 1);
          parts.push(value);
          if (opts.tokens) {
            tokens[tokens.length - 1].value = value;
            depth(tokens[tokens.length - 1]);
            state.maxDepth += tokens[tokens.length - 1].depth;
          }
        }
        state.slashes = slashes;
        state.parts = parts;
      }
      return state;
    };
    module.exports = scan;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/parse.js
var require_parse2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/parse.js"(exports, module) {
    "use strict";
    var constants = require_constants2();
    var utils = require_utils2();
    var {
      MAX_LENGTH,
      POSIX_REGEX_SOURCE,
      REGEX_NON_SPECIAL_CHARS,
      REGEX_SPECIAL_CHARS_BACKREF,
      REPLACEMENTS
    } = constants;
    var expandRange = (args, options) => {
      if (typeof options.expandRange === "function") {
        return options.expandRange(...args, options);
      }
      args.sort();
      const value = `[${args.join("-")}]`;
      try {
        new RegExp(value);
      } catch (ex) {
        return args.map((v) => utils.escapeRegex(v)).join("..");
      }
      return value;
    };
    var syntaxError = (type, char) => {
      return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
    };
    var splitTopLevel = (input) => {
      const parts = [];
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let value = "";
      let escaped = false;
      for (const ch of input) {
        if (escaped === true) {
          value += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          value += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          value += ch;
          continue;
        }
        if (quote === 0) {
          if (ch === "[") {
            bracket++;
          } else if (ch === "]" && bracket > 0) {
            bracket--;
          } else if (bracket === 0) {
            if (ch === "(") {
              paren++;
            } else if (ch === ")" && paren > 0) {
              paren--;
            } else if (ch === "|" && paren === 0) {
              parts.push(value);
              value = "";
              continue;
            }
          }
        }
        value += ch;
      }
      parts.push(value);
      return parts;
    };
    var isPlainBranch = (branch) => {
      let escaped = false;
      for (const ch of branch) {
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (/[?*+@!()[\]{}]/.test(ch)) {
          return false;
        }
      }
      return true;
    };
    var normalizeSimpleBranch = (branch) => {
      let value = branch.trim();
      let changed = true;
      while (changed === true) {
        changed = false;
        if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
          value = value.slice(2, -1);
          changed = true;
        }
      }
      if (!isPlainBranch(value)) {
        return;
      }
      return value.replace(/\\(.)/g, "$1");
    };
    var hasRepeatedCharPrefixOverlap = (branches) => {
      const values = branches.map(normalizeSimpleBranch).filter(Boolean);
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i];
          const b = values[j];
          const char = a[0];
          if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
            continue;
          }
          if (a === b || a.startsWith(b) || b.startsWith(a)) {
            return true;
          }
        }
      }
      return false;
    };
    var parseRepeatedExtglob = (pattern, requireEnd = true) => {
      if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
        return;
      }
      let bracket = 0;
      let paren = 0;
      let quote = 0;
      let escaped = false;
      for (let i = 1; i < pattern.length; i++) {
        const ch = pattern[i];
        if (escaped === true) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          quote = quote === 1 ? 0 : 1;
          continue;
        }
        if (quote === 1) {
          continue;
        }
        if (ch === "[") {
          bracket++;
          continue;
        }
        if (ch === "]" && bracket > 0) {
          bracket--;
          continue;
        }
        if (bracket > 0) {
          continue;
        }
        if (ch === "(") {
          paren++;
          continue;
        }
        if (ch === ")") {
          paren--;
          if (paren === 0) {
            if (requireEnd === true && i !== pattern.length - 1) {
              return;
            }
            return {
              type: pattern[0],
              body: pattern.slice(2, i),
              end: i
            };
          }
        }
      }
    };
    var getStarExtglobSequenceOutput = (pattern) => {
      let index = 0;
      const chars = [];
      while (index < pattern.length) {
        const match = parseRepeatedExtglob(pattern.slice(index), false);
        if (!match || match.type !== "*") {
          return;
        }
        const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
        if (branches.length !== 1) {
          return;
        }
        const branch = normalizeSimpleBranch(branches[0]);
        if (!branch || branch.length !== 1) {
          return;
        }
        chars.push(branch);
        index += match.end + 1;
      }
      if (chars.length < 1) {
        return;
      }
      const source = chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`;
      return `${source}*`;
    };
    var repeatedExtglobRecursion = (pattern) => {
      let depth = 0;
      let value = pattern.trim();
      let match = parseRepeatedExtglob(value);
      while (match) {
        depth++;
        value = match.body.trim();
        match = parseRepeatedExtglob(value);
      }
      return depth;
    };
    var analyzeRepeatedExtglob = (body, options) => {
      if (options.maxExtglobRecursion === false) {
        return { risky: false };
      }
      const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
      const branches = splitTopLevel(body).map((branch) => branch.trim());
      if (branches.length > 1) {
        if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
          return { risky: true };
        }
      }
      for (const branch of branches) {
        const safeOutput = getStarExtglobSequenceOutput(branch);
        if (safeOutput) {
          return { risky: true, safeOutput };
        }
        if (repeatedExtglobRecursion(branch) > max) {
          return { risky: true };
        }
      }
      return { risky: false };
    };
    var parse = (input, options) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected a string");
      }
      input = REPLACEMENTS[input] || input;
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      let len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      const bos = { type: "bos", value: "", output: opts.prepend || "" };
      const tokens = [bos];
      const capture = opts.capture ? "" : "?:";
      const win32 = utils.isWindows(options);
      const PLATFORM_CHARS = constants.globChars(win32);
      const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
      const {
        DOT_LITERAL,
        PLUS_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOT_SLASH,
        NO_DOTS_SLASH,
        QMARK,
        QMARK_NO_DOT,
        STAR,
        START_ANCHOR
      } = PLATFORM_CHARS;
      const globstar = (opts2) => {
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const nodot = opts.dot ? "" : NO_DOT;
      const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
      let star = opts.bash === true ? globstar(opts) : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      if (typeof opts.noext === "boolean") {
        opts.noextglob = opts.noext;
      }
      const state = {
        input,
        index: -1,
        start: 0,
        dot: opts.dot === true,
        consumed: "",
        output: "",
        prefix: "",
        backtrack: false,
        negated: false,
        brackets: 0,
        braces: 0,
        parens: 0,
        quotes: 0,
        globstar: false,
        tokens
      };
      input = utils.removePrefix(input, state);
      len = input.length;
      const extglobs = [];
      const braces = [];
      const stack = [];
      let prev = bos;
      let value;
      const eos = () => state.index === len - 1;
      const peek = state.peek = (n = 1) => input[state.index + n];
      const advance = state.advance = () => input[++state.index] || "";
      const remaining = () => input.slice(state.index + 1);
      const consume = (value2 = "", num = 0) => {
        state.consumed += value2;
        state.index += num;
      };
      const append = (token) => {
        state.output += token.output != null ? token.output : token.value;
        consume(token.value);
      };
      const negate = () => {
        let count = 1;
        while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
          advance();
          state.start++;
          count++;
        }
        if (count % 2 === 0) {
          return false;
        }
        state.negated = true;
        state.start++;
        return true;
      };
      const increment = (type) => {
        state[type]++;
        stack.push(type);
      };
      const decrement = (type) => {
        state[type]--;
        stack.pop();
      };
      const push = (tok) => {
        if (prev.type === "globstar") {
          const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
          const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
          if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
            state.output = state.output.slice(0, -prev.output.length);
            prev.type = "star";
            prev.value = "*";
            prev.output = star;
            state.output += prev.output;
          }
        }
        if (extglobs.length && tok.type !== "paren") {
          extglobs[extglobs.length - 1].inner += tok.value;
        }
        if (tok.value || tok.output) append(tok);
        if (prev && prev.type === "text" && tok.type === "text") {
          prev.value += tok.value;
          prev.output = (prev.output || "") + tok.value;
          return;
        }
        tok.prev = prev;
        tokens.push(tok);
        prev = tok;
      };
      const extglobOpen = (type, value2) => {
        const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
        token.prev = prev;
        token.parens = state.parens;
        token.output = state.output;
        token.startIndex = state.index;
        token.tokensIndex = tokens.length;
        const output = (opts.capture ? "(" : "") + token.open;
        increment("parens");
        push({ type, value: value2, output: state.output ? "" : ONE_CHAR });
        push({ type: "paren", extglob: true, value: advance(), output });
        extglobs.push(token);
      };
      const extglobClose = (token) => {
        const literal = input.slice(token.startIndex, state.index + 1);
        const body = input.slice(token.startIndex + 2, state.index);
        const analysis = analyzeRepeatedExtglob(body, opts);
        if ((token.type === "plus" || token.type === "star") && analysis.risky) {
          const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
          const open = tokens[token.tokensIndex];
          open.type = "text";
          open.value = literal;
          open.output = safeOutput || utils.escapeRegex(literal);
          for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
            tokens[i].value = "";
            tokens[i].output = "";
            delete tokens[i].suffix;
          }
          state.output = token.output + open.output;
          state.backtrack = true;
          push({ type: "paren", extglob: true, value, output: "" });
          decrement("parens");
          return;
        }
        let output = token.close + (opts.capture ? ")" : "");
        let rest;
        if (token.type === "negate") {
          let extglobStar = star;
          if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
            extglobStar = globstar(opts);
          }
          if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
            output = token.close = `)$))${extglobStar}`;
          }
          if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
            const expression = parse(rest, { ...options, fastpaths: false }).output;
            output = token.close = `)${expression})${extglobStar})`;
          }
          if (token.prev.type === "bos") {
            state.negatedExtglob = true;
          }
        }
        push({ type: "paren", extglob: true, value, output });
        decrement("parens");
      };
      if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
        let backslashes = false;
        let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
          if (first === "\\") {
            backslashes = true;
            return m;
          }
          if (first === "?") {
            if (esc) {
              return esc + first + (rest ? QMARK.repeat(rest.length) : "");
            }
            if (index === 0) {
              return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
            }
            return QMARK.repeat(chars.length);
          }
          if (first === ".") {
            return DOT_LITERAL.repeat(chars.length);
          }
          if (first === "*") {
            if (esc) {
              return esc + first + (rest ? star : "");
            }
            return star;
          }
          return esc ? m : `\\${m}`;
        });
        if (backslashes === true) {
          if (opts.unescape === true) {
            output = output.replace(/\\/g, "");
          } else {
            output = output.replace(/\\+/g, (m) => {
              return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
            });
          }
        }
        if (output === input && opts.contains === true) {
          state.output = input;
          return state;
        }
        state.output = utils.wrapOutput(output, state, options);
        return state;
      }
      while (!eos()) {
        value = advance();
        if (value === "\0") {
          continue;
        }
        if (value === "\\") {
          const next = peek();
          if (next === "/" && opts.bash !== true) {
            continue;
          }
          if (next === "." || next === ";") {
            continue;
          }
          if (!next) {
            value += "\\";
            push({ type: "text", value });
            continue;
          }
          const match = /^\\+/.exec(remaining());
          let slashes = 0;
          if (match && match[0].length > 2) {
            slashes = match[0].length;
            state.index += slashes;
            if (slashes % 2 !== 0) {
              value += "\\";
            }
          }
          if (opts.unescape === true) {
            value = advance();
          } else {
            value += advance();
          }
          if (state.brackets === 0) {
            push({ type: "text", value });
            continue;
          }
        }
        if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
          if (opts.posix !== false && value === ":") {
            const inner = prev.value.slice(1);
            if (inner.includes("[")) {
              prev.posix = true;
              if (inner.includes(":")) {
                const idx = prev.value.lastIndexOf("[");
                const pre = prev.value.slice(0, idx);
                const rest2 = prev.value.slice(idx + 2);
                const posix = POSIX_REGEX_SOURCE[rest2];
                if (posix) {
                  prev.value = pre + posix;
                  state.backtrack = true;
                  advance();
                  if (!bos.output && tokens.indexOf(prev) === 1) {
                    bos.output = ONE_CHAR;
                  }
                  continue;
                }
              }
            }
          }
          if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
            value = `\\${value}`;
          }
          if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
            value = `\\${value}`;
          }
          if (opts.posix === true && value === "!" && prev.value === "[") {
            value = "^";
          }
          prev.value += value;
          append({ value });
          continue;
        }
        if (state.quotes === 1 && value !== '"') {
          value = utils.escapeRegex(value);
          prev.value += value;
          append({ value });
          continue;
        }
        if (value === '"') {
          state.quotes = state.quotes === 1 ? 0 : 1;
          if (opts.keepQuotes === true) {
            push({ type: "text", value });
          }
          continue;
        }
        if (value === "(") {
          increment("parens");
          push({ type: "paren", value });
          continue;
        }
        if (value === ")") {
          if (state.parens === 0 && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "("));
          }
          const extglob = extglobs[extglobs.length - 1];
          if (extglob && state.parens === extglob.parens + 1) {
            extglobClose(extglobs.pop());
            continue;
          }
          push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
          decrement("parens");
          continue;
        }
        if (value === "[") {
          if (opts.nobracket === true || !remaining().includes("]")) {
            if (opts.nobracket !== true && opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("closing", "]"));
            }
            value = `\\${value}`;
          } else {
            increment("brackets");
          }
          push({ type: "bracket", value });
          continue;
        }
        if (value === "]") {
          if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          if (state.brackets === 0) {
            if (opts.strictBrackets === true) {
              throw new SyntaxError(syntaxError("opening", "["));
            }
            push({ type: "text", value, output: `\\${value}` });
            continue;
          }
          decrement("brackets");
          const prevValue = prev.value.slice(1);
          if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
            value = `/${value}`;
          }
          prev.value += value;
          append({ value });
          if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
            continue;
          }
          const escaped = utils.escapeRegex(prev.value);
          state.output = state.output.slice(0, -prev.value.length);
          if (opts.literalBrackets === true) {
            state.output += escaped;
            prev.value = escaped;
            continue;
          }
          prev.value = `(${capture}${escaped}|${prev.value})`;
          state.output += prev.value;
          continue;
        }
        if (value === "{" && opts.nobrace !== true) {
          increment("braces");
          const open = {
            type: "brace",
            value,
            output: "(",
            outputIndex: state.output.length,
            tokensIndex: state.tokens.length
          };
          braces.push(open);
          push(open);
          continue;
        }
        if (value === "}") {
          const brace = braces[braces.length - 1];
          if (opts.nobrace === true || !brace) {
            push({ type: "text", value, output: value });
            continue;
          }
          let output = ")";
          if (brace.dots === true) {
            const arr = tokens.slice();
            const range = [];
            for (let i = arr.length - 1; i >= 0; i--) {
              tokens.pop();
              if (arr[i].type === "brace") {
                break;
              }
              if (arr[i].type !== "dots") {
                range.unshift(arr[i].value);
              }
            }
            output = expandRange(range, opts);
            state.backtrack = true;
          }
          if (brace.comma !== true && brace.dots !== true) {
            const out = state.output.slice(0, brace.outputIndex);
            const toks = state.tokens.slice(brace.tokensIndex);
            brace.value = brace.output = "\\{";
            value = output = "\\}";
            state.output = out;
            for (const t of toks) {
              state.output += t.output || t.value;
            }
          }
          push({ type: "brace", value, output });
          decrement("braces");
          braces.pop();
          continue;
        }
        if (value === "|") {
          if (extglobs.length > 0) {
            extglobs[extglobs.length - 1].conditions++;
          }
          push({ type: "text", value });
          continue;
        }
        if (value === ",") {
          let output = value;
          const brace = braces[braces.length - 1];
          if (brace && stack[stack.length - 1] === "braces") {
            brace.comma = true;
            output = "|";
          }
          push({ type: "comma", value, output });
          continue;
        }
        if (value === "/") {
          if (prev.type === "dot" && state.index === state.start + 1) {
            state.start = state.index + 1;
            state.consumed = "";
            state.output = "";
            tokens.pop();
            prev = bos;
            continue;
          }
          push({ type: "slash", value, output: SLASH_LITERAL });
          continue;
        }
        if (value === ".") {
          if (state.braces > 0 && prev.type === "dot") {
            if (prev.value === ".") prev.output = DOT_LITERAL;
            const brace = braces[braces.length - 1];
            prev.type = "dots";
            prev.output += value;
            prev.value += value;
            brace.dots = true;
            continue;
          }
          if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
            push({ type: "text", value, output: DOT_LITERAL });
            continue;
          }
          push({ type: "dot", value, output: DOT_LITERAL });
          continue;
        }
        if (value === "?") {
          const isGroup = prev && prev.value === "(";
          if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("qmark", value);
            continue;
          }
          if (prev && prev.type === "paren") {
            const next = peek();
            let output = value;
            if (next === "<" && !utils.supportsLookbehinds()) {
              throw new Error("Node.js v10 or higher is required for regex lookbehinds");
            }
            if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
              output = `\\${value}`;
            }
            push({ type: "text", value, output });
            continue;
          }
          if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
            push({ type: "qmark", value, output: QMARK_NO_DOT });
            continue;
          }
          push({ type: "qmark", value, output: QMARK });
          continue;
        }
        if (value === "!") {
          if (opts.noextglob !== true && peek() === "(") {
            if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
              extglobOpen("negate", value);
              continue;
            }
          }
          if (opts.nonegate !== true && state.index === 0) {
            negate();
            continue;
          }
        }
        if (value === "+") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            extglobOpen("plus", value);
            continue;
          }
          if (prev && prev.value === "(" || opts.regex === false) {
            push({ type: "plus", value, output: PLUS_LITERAL });
            continue;
          }
          if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
            push({ type: "plus", value });
            continue;
          }
          push({ type: "plus", value: PLUS_LITERAL });
          continue;
        }
        if (value === "@") {
          if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
            push({ type: "at", extglob: true, value, output: "" });
            continue;
          }
          push({ type: "text", value });
          continue;
        }
        if (value !== "*") {
          if (value === "$" || value === "^") {
            value = `\\${value}`;
          }
          const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
          if (match) {
            value += match[0];
            state.index += match[0].length;
          }
          push({ type: "text", value });
          continue;
        }
        if (prev && (prev.type === "globstar" || prev.star === true)) {
          prev.type = "star";
          prev.star = true;
          prev.value += value;
          prev.output = star;
          state.backtrack = true;
          state.globstar = true;
          consume(value);
          continue;
        }
        let rest = remaining();
        if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
          extglobOpen("star", value);
          continue;
        }
        if (prev.type === "star") {
          if (opts.noglobstar === true) {
            consume(value);
            continue;
          }
          const prior = prev.prev;
          const before = prior.prev;
          const isStart = prior.type === "slash" || prior.type === "bos";
          const afterStar = before && (before.type === "star" || before.type === "globstar");
          if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
            push({ type: "star", value, output: "" });
            continue;
          }
          const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
          const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
          if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
            push({ type: "star", value, output: "" });
            continue;
          }
          while (rest.slice(0, 3) === "/**") {
            const after = input[state.index + 4];
            if (after && after !== "/") {
              break;
            }
            rest = rest.slice(3);
            consume("/**", 3);
          }
          if (prior.type === "bos" && eos()) {
            prev.type = "globstar";
            prev.value += value;
            prev.output = globstar(opts);
            state.output = prev.output;
            state.globstar = true;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && eos()) {
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
            prev.value += value;
            state.globstar = true;
            state.output += prior.output + prev.output;
            consume(value);
            continue;
          }
          if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
            const end = rest[1] !== void 0 ? "|$" : "";
            state.output = state.output.slice(0, -(prior.output + prev.output).length);
            prior.output = `(?:${prior.output}`;
            prev.type = "globstar";
            prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
            prev.value += value;
            state.output += prior.output + prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          if (prior.type === "bos" && rest[0] === "/") {
            prev.type = "globstar";
            prev.value += value;
            prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
            state.output = prev.output;
            state.globstar = true;
            consume(value + advance());
            push({ type: "slash", value: "/", output: "" });
            continue;
          }
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "globstar";
          prev.output = globstar(opts);
          prev.value += value;
          state.output += prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        const token = { type: "star", value, output: star };
        if (opts.bash === true) {
          token.output = ".*?";
          if (prev.type === "bos" || prev.type === "slash") {
            token.output = nodot + token.output;
          }
          push(token);
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
          token.output = value;
          push(token);
          continue;
        }
        if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
          if (prev.type === "dot") {
            state.output += NO_DOT_SLASH;
            prev.output += NO_DOT_SLASH;
          } else if (opts.dot === true) {
            state.output += NO_DOTS_SLASH;
            prev.output += NO_DOTS_SLASH;
          } else {
            state.output += nodot;
            prev.output += nodot;
          }
          if (peek() !== "*") {
            state.output += ONE_CHAR;
            prev.output += ONE_CHAR;
          }
        }
        push(token);
      }
      while (state.brackets > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
        state.output = utils.escapeLast(state.output, "[");
        decrement("brackets");
      }
      while (state.parens > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
        state.output = utils.escapeLast(state.output, "(");
        decrement("parens");
      }
      while (state.braces > 0) {
        if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
        state.output = utils.escapeLast(state.output, "{");
        decrement("braces");
      }
      if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
        push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
      }
      if (state.backtrack === true) {
        state.output = "";
        for (const token of state.tokens) {
          state.output += token.output != null ? token.output : token.value;
          if (token.suffix) {
            state.output += token.suffix;
          }
        }
      }
      return state;
    };
    parse.fastpaths = (input, options) => {
      const opts = { ...options };
      const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
      const len = input.length;
      if (len > max) {
        throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
      }
      input = REPLACEMENTS[input] || input;
      const win32 = utils.isWindows(options);
      const {
        DOT_LITERAL,
        SLASH_LITERAL,
        ONE_CHAR,
        DOTS_SLASH,
        NO_DOT,
        NO_DOTS,
        NO_DOTS_SLASH,
        STAR,
        START_ANCHOR
      } = constants.globChars(win32);
      const nodot = opts.dot ? NO_DOTS : NO_DOT;
      const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
      const capture = opts.capture ? "" : "?:";
      const state = { negated: false, prefix: "" };
      let star = opts.bash === true ? ".*?" : STAR;
      if (opts.capture) {
        star = `(${star})`;
      }
      const globstar = (opts2) => {
        if (opts2.noglobstar === true) return star;
        return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
      };
      const create = (str) => {
        switch (str) {
          case "*":
            return `${nodot}${ONE_CHAR}${star}`;
          case ".*":
            return `${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*.*":
            return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "*/*":
            return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
          case "**":
            return nodot + globstar(opts);
          case "**/*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
          case "**/*.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
          case "**/.*":
            return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
          default: {
            const match = /^(.*?)\.(\w+)$/.exec(str);
            if (!match) return;
            const source2 = create(match[1]);
            if (!source2) return;
            return source2 + DOT_LITERAL + match[2];
          }
        }
      };
      const output = utils.removePrefix(input, state);
      let source = create(output);
      if (source && opts.strictSlashes !== true) {
        source += `${SLASH_LITERAL}?`;
      }
      return source;
    };
    module.exports = parse;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/lib/picomatch.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var scan = require_scan();
    var parse = require_parse2();
    var utils = require_utils2();
    var constants = require_constants2();
    var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
    var picomatch = (glob, options, returnState = false) => {
      if (Array.isArray(glob)) {
        const fns = glob.map((input) => picomatch(input, options, returnState));
        const arrayMatcher = (str) => {
          for (const isMatch of fns) {
            const state2 = isMatch(str);
            if (state2) return state2;
          }
          return false;
        };
        return arrayMatcher;
      }
      const isState = isObject(glob) && glob.tokens && glob.input;
      if (glob === "" || typeof glob !== "string" && !isState) {
        throw new TypeError("Expected pattern to be a non-empty string");
      }
      const opts = options || {};
      const posix = utils.isWindows(options);
      const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
      const state = regex.state;
      delete regex.state;
      let isIgnored = () => false;
      if (opts.ignore) {
        const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
        isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
      }
      const matcher = (input, returnObject = false) => {
        const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
        const result = { glob, state, regex, posix, input, output, match, isMatch };
        if (typeof opts.onResult === "function") {
          opts.onResult(result);
        }
        if (isMatch === false) {
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (isIgnored(input)) {
          if (typeof opts.onIgnore === "function") {
            opts.onIgnore(result);
          }
          result.isMatch = false;
          return returnObject ? result : false;
        }
        if (typeof opts.onMatch === "function") {
          opts.onMatch(result);
        }
        return returnObject ? result : true;
      };
      if (returnState) {
        matcher.state = state;
      }
      return matcher;
    };
    picomatch.test = (input, regex, options, { glob, posix } = {}) => {
      if (typeof input !== "string") {
        throw new TypeError("Expected input to be a string");
      }
      if (input === "") {
        return { isMatch: false, output: "" };
      }
      const opts = options || {};
      const format = opts.format || (posix ? utils.toPosixSlashes : null);
      let match = input === glob;
      let output = match && format ? format(input) : input;
      if (match === false) {
        output = format ? format(input) : input;
        match = output === glob;
      }
      if (match === false || opts.capture === true) {
        if (opts.matchBase === true || opts.basename === true) {
          match = picomatch.matchBase(input, regex, options, posix);
        } else {
          match = regex.exec(output);
        }
      }
      return { isMatch: Boolean(match), match, output };
    };
    picomatch.matchBase = (input, glob, options, posix = utils.isWindows(options)) => {
      const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
      return regex.test(path.basename(input));
    };
    picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
    picomatch.parse = (pattern, options) => {
      if (Array.isArray(pattern)) return pattern.map((p) => picomatch.parse(p, options));
      return parse(pattern, { ...options, fastpaths: false });
    };
    picomatch.scan = (input, options) => scan(input, options);
    picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
      if (returnOutput === true) {
        return state.output;
      }
      const opts = options || {};
      const prepend = opts.contains ? "" : "^";
      const append = opts.contains ? "" : "$";
      let source = `${prepend}(?:${state.output})${append}`;
      if (state && state.negated === true) {
        source = `^(?!${source}).*$`;
      }
      const regex = picomatch.toRegex(source, options);
      if (returnState === true) {
        regex.state = state;
      }
      return regex;
    };
    picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
      if (!input || typeof input !== "string") {
        throw new TypeError("Expected a non-empty string");
      }
      let parsed = { negated: false, fastpaths: true };
      if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
        parsed.output = parse.fastpaths(input, options);
      }
      if (!parsed.output) {
        parsed = parse(input, options);
      }
      return picomatch.compileRe(parsed, options, returnOutput, returnState);
    };
    picomatch.toRegex = (source, options) => {
      try {
        const opts = options || {};
        return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
      } catch (err) {
        if (options && options.debug === true) throw err;
        return /$^/;
      }
    };
    picomatch.constants = constants;
    module.exports = picomatch;
  }
});

// node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS({
  "node_modules/.pnpm/picomatch@2.3.2/node_modules/picomatch/index.js"(exports, module) {
    "use strict";
    module.exports = require_picomatch();
  }
});

// node_modules/.pnpm/micromatch@4.0.8/node_modules/micromatch/index.js
var require_micromatch = __commonJS({
  "node_modules/.pnpm/micromatch@4.0.8/node_modules/micromatch/index.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var braces = require_braces();
    var picomatch = require_picomatch2();
    var utils = require_utils2();
    var isEmptyString = (v) => v === "" || v === "./";
    var hasBraces = (v) => {
      const index = v.indexOf("{");
      return index > -1 && v.indexOf("}", index) > -1;
    };
    var micromatch2 = (list, patterns, options) => {
      patterns = [].concat(patterns);
      list = [].concat(list);
      let omit = /* @__PURE__ */ new Set();
      let keep = /* @__PURE__ */ new Set();
      let items = /* @__PURE__ */ new Set();
      let negatives = 0;
      let onResult = (state) => {
        items.add(state.output);
        if (options && options.onResult) {
          options.onResult(state);
        }
      };
      for (let i = 0; i < patterns.length; i++) {
        let isMatch = picomatch(String(patterns[i]), { ...options, onResult }, true);
        let negated = isMatch.state.negated || isMatch.state.negatedExtglob;
        if (negated) negatives++;
        for (let item of list) {
          let matched = isMatch(item, true);
          let match = negated ? !matched.isMatch : matched.isMatch;
          if (!match) continue;
          if (negated) {
            omit.add(matched.output);
          } else {
            omit.delete(matched.output);
            keep.add(matched.output);
          }
        }
      }
      let result = negatives === patterns.length ? [...items] : [...keep];
      let matches = result.filter((item) => !omit.has(item));
      if (options && matches.length === 0) {
        if (options.failglob === true) {
          throw new Error(`No matches found for "${patterns.join(", ")}"`);
        }
        if (options.nonull === true || options.nullglob === true) {
          return options.unescape ? patterns.map((p) => p.replace(/\\/g, "")) : patterns;
        }
      }
      return matches;
    };
    micromatch2.match = micromatch2;
    micromatch2.matcher = (pattern, options) => picomatch(pattern, options);
    micromatch2.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
    micromatch2.any = micromatch2.isMatch;
    micromatch2.not = (list, patterns, options = {}) => {
      patterns = [].concat(patterns).map(String);
      let result = /* @__PURE__ */ new Set();
      let items = [];
      let onResult = (state) => {
        if (options.onResult) options.onResult(state);
        items.push(state.output);
      };
      let matches = new Set(micromatch2(list, patterns, { ...options, onResult }));
      for (let item of items) {
        if (!matches.has(item)) {
          result.add(item);
        }
      }
      return [...result];
    };
    micromatch2.contains = (str, pattern, options) => {
      if (typeof str !== "string") {
        throw new TypeError(`Expected a string: "${util.inspect(str)}"`);
      }
      if (Array.isArray(pattern)) {
        return pattern.some((p) => micromatch2.contains(str, p, options));
      }
      if (typeof pattern === "string") {
        if (isEmptyString(str) || isEmptyString(pattern)) {
          return false;
        }
        if (str.includes(pattern) || str.startsWith("./") && str.slice(2).includes(pattern)) {
          return true;
        }
      }
      return micromatch2.isMatch(str, pattern, { ...options, contains: true });
    };
    micromatch2.matchKeys = (obj, patterns, options) => {
      if (!utils.isObject(obj)) {
        throw new TypeError("Expected the first argument to be an object");
      }
      let keys = micromatch2(Object.keys(obj), patterns, options);
      let res = {};
      for (let key of keys) res[key] = obj[key];
      return res;
    };
    micromatch2.some = (list, patterns, options) => {
      let items = [].concat(list);
      for (let pattern of [].concat(patterns)) {
        let isMatch = picomatch(String(pattern), options);
        if (items.some((item) => isMatch(item))) {
          return true;
        }
      }
      return false;
    };
    micromatch2.every = (list, patterns, options) => {
      let items = [].concat(list);
      for (let pattern of [].concat(patterns)) {
        let isMatch = picomatch(String(pattern), options);
        if (!items.every((item) => isMatch(item))) {
          return false;
        }
      }
      return true;
    };
    micromatch2.all = (str, patterns, options) => {
      if (typeof str !== "string") {
        throw new TypeError(`Expected a string: "${util.inspect(str)}"`);
      }
      return [].concat(patterns).every((p) => picomatch(p, options)(str));
    };
    micromatch2.capture = (glob, input, options) => {
      let posix = utils.isWindows(options);
      let regex = picomatch.makeRe(String(glob), { ...options, capture: true });
      let match = regex.exec(posix ? utils.toPosixSlashes(input) : input);
      if (match) {
        return match.slice(1).map((v) => v === void 0 ? "" : v);
      }
    };
    micromatch2.makeRe = (...args) => picomatch.makeRe(...args);
    micromatch2.scan = (...args) => picomatch.scan(...args);
    micromatch2.parse = (patterns, options) => {
      let res = [];
      for (let pattern of [].concat(patterns || [])) {
        for (let str of braces(String(pattern), options)) {
          res.push(picomatch.parse(str, options));
        }
      }
      return res;
    };
    micromatch2.braces = (pattern, options) => {
      if (typeof pattern !== "string") throw new TypeError("Expected a string");
      if (options && options.nobrace === true || !hasBraces(pattern)) {
        return [pattern];
      }
      return braces(pattern, options);
    };
    micromatch2.braceExpand = (pattern, options) => {
      if (typeof pattern !== "string") throw new TypeError("Expected a string");
      return micromatch2.braces(pattern, { ...options, expand: true });
    };
    micromatch2.hasBraces = hasBraces;
    module.exports = micromatch2;
  }
});

// src/plugins/artifact-generators/react-component-structure/cli/command.ts
import { mkdir as mkdir2, mkdtemp as mkdtemp2, writeFile } from "fs/promises";
import { tmpdir as tmpdir2 } from "os";
import { dirname as dirname2, join as join3 } from "path";

// src/plugins/artifact-generators/react-component-structure/analysis/build-component-graph.ts
var import_ignore2 = __toESM(require_ignore(), 1);
var import_micromatch = __toESM(require_micromatch(), 1);
import { createHash as createHash2 } from "crypto";
import { lstat as lstat2, realpath as realpath2 } from "fs/promises";
import { basename, extname as extname2, relative as relative3, resolve as resolve3 } from "path";

// src/shared/node/path.ts
import { isAbsolute, relative, sep } from "path";
function toPosixPath(path) {
  return path.split(sep).join("/");
}
function isPathInside(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}
function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// src/plugins/artifact-generators/react-component-structure/analysis/collect-source-files.ts
var import_ignore = __toESM(require_ignore(), 1);
import { readdir, readFile, realpath, stat } from "fs/promises";
import { dirname, extname, isAbsolute as isAbsolute2, join, relative as relative2, resolve } from "path";
var sourceExtensions = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs"]);
var alwaysIgnoredDirectoryNames = /* @__PURE__ */ new Set([".git", "node_modules"]);
async function readIgnoreFileContents(ignoreFilePath) {
  let contents;
  try {
    contents = await readFile(ignoreFilePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return void 0;
    throw error;
  }
  return contents;
}
function addIgnoreRules(rules, contents) {
  return contents === void 0 ? rules : (0, import_ignore.default)().add(rules).add(contents);
}
async function collectInheritedIgnoreRules(scopePath, directoryPath) {
  let rules = (0, import_ignore.default)();
  const directoryRelativePath = relative2(scopePath, directoryPath);
  let currentPath = scopePath;
  for (const segment of ["", ...directoryRelativePath ? directoryRelativePath.split(/[\\/]/) : []]) {
    if (segment) currentPath = join(currentPath, segment);
    rules = addIgnoreRules(rules, await readIgnoreFileContents(join(currentPath, ".gitignore")));
  }
  return rules;
}
function isPathIgnored(rules, relativePath, isDirectory) {
  return rules.ignores(relativePath) || isDirectory && rules.ignores(`${relativePath}/`);
}
async function collectSourceFiles(scopePath, sourcePaths) {
  const files = /* @__PURE__ */ new Set();
  async function visitFile(resolvedPath) {
    if (!sourceExtensions.has(extname(resolvedPath))) return;
    files.add(resolvedPath);
  }
  async function visitDirectory(directoryPath, inheritedRules) {
    const directoryRules = addIgnoreRules(
      inheritedRules,
      await readIgnoreFileContents(join(directoryPath, ".gitignore"))
    );
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const resolvedPath = await realpath(join(directoryPath, entry.name));
      if (!isPathInside(scopePath, resolvedPath)) {
        throw new Error(`Source path must stay inside the base: ${join(directoryPath, entry.name)}`);
      }
      const relativePath = toPosixPath(relative2(scopePath, resolvedPath));
      if (entry.isDirectory()) {
        if (alwaysIgnoredDirectoryNames.has(entry.name)) continue;
        if (relativePath && isPathIgnored(directoryRules, relativePath, true)) continue;
        await visitDirectory(resolvedPath, directoryRules);
        continue;
      }
      if (relativePath && isPathIgnored(directoryRules, relativePath, false)) continue;
      await visitFile(resolvedPath);
    }
  }
  for (const sourcePath of sourcePaths) {
    const resolvedRoot = await realpath(isAbsolute2(sourcePath) ? sourcePath : resolve(scopePath, sourcePath));
    if (!isPathInside(scopePath, resolvedRoot)) {
      throw new Error(`Source path must stay inside the base: ${sourcePath}`);
    }
    const inheritedRules = resolvedRoot === scopePath ? (0, import_ignore.default)() : await collectInheritedIgnoreRules(scopePath, dirname(resolvedRoot));
    const rootStat = await stat(resolvedRoot);
    if (rootStat.isDirectory()) {
      await visitDirectory(resolvedRoot, inheritedRules);
    } else if (rootStat.isFile()) {
      await visitFile(resolvedRoot);
    }
  }
  return [...files].toSorted();
}

// src/plugins/artifact-generators/react-component-structure/analysis/load-typescript.ts
import { execFile } from "child_process";
import { createHash } from "crypto";
import { access, chmod, lstat, mkdir, mkdtemp, readFile as readFile2, rename, rm, rmdir } from "fs/promises";
import { createRequire } from "module";
import { homedir, tmpdir } from "os";
import { join as join2, resolve as resolve2 } from "path";
import { setTimeout } from "timers/promises";
import { promisify } from "util";

// node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/package.json
var version = "5.9.3";

// src/plugins/artifact-generators/react-component-structure/analysis/load-typescript.ts
var require2 = createRequire(import.meta.url);
var installations = /* @__PURE__ */ new Map();
async function hasCachedPackage(directory) {
  let contents;
  try {
    const cacheStat = await lstat(directory);
    if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
      throw new Error(`Unsafe TypeScript temporary cache directory: ${directory}`);
    }
    contents = await readFile2(join2(directory, "node_modules/typescript/package.json"), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
  if (JSON.parse(contents).version !== version) {
    throw new Error(`Unexpected TypeScript version in temporary cache: ${directory}`);
  }
  try {
    await access(require2.resolve(join2(directory, "node_modules/typescript")));
    await access(join2(directory, "node_modules/typescript/lib/lib.esnext.full.d.ts"));
    await access(join2(directory, "node_modules/typescript/lib/lib.es5.d.ts"));
  } catch (error) {
    if (isMissingPathError(error) || error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return false;
    }
    throw error;
  }
  return true;
}
async function acquireInstallationLock(cachePath) {
  const lockPath = `${cachePath}.lock`;
  const deadline = Date.now() + 12e4;
  for (; ; ) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for TypeScript temporary installation lock: ${lockPath}`);
    }
    try {
      await mkdir(lockPath, { mode: 448 });
      return () => rmdir(lockPath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
    try {
      const lockStat = await lstat(lockPath);
      if (!lockStat.isDirectory() || process.getuid && lockStat.uid !== process.getuid()) {
        throw new Error(`Unsafe TypeScript temporary lock directory: ${lockPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    await setTimeout(50);
  }
}
async function installFallback(cacheRoot, cachePath) {
  const releaseLock = await acquireInstallationLock(cachePath);
  try {
    if (await hasCachedPackage(cachePath)) return;
    await installFallbackPackage(cacheRoot, cachePath);
  } finally {
    await releaseLock();
  }
}
async function installFallbackPackage(cacheRoot, cachePath) {
  const directory = await mkdtemp(join2(cacheRoot, `${version}-install-`));
  try {
    try {
      await promisify(execFile)(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
          "install",
          "--prefix",
          ".",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          "--no-save",
          `typescript@${version}`
        ],
        { cwd: directory, shell: process.platform === "win32", windowsHide: true, timeout: 12e4 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot install fallback TypeScript ${version}: ${message}`, { cause: error });
    }
    if (!await hasCachedPackage(directory)) {
      throw new Error(`npm did not install fallback TypeScript ${version}.`);
    }
    if (!await hasCachedPackage(cachePath)) {
      try {
        const cacheStat = await lstat(cachePath);
        if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
          throw new Error(`Unsafe TypeScript temporary cache directory: ${cachePath}`);
        }
        const quarantine = await mkdtemp(join2(cacheRoot, `${version}-invalid-`));
        await rename(cachePath, join2(quarantine, "cache"));
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }
    try {
      await rename(directory, cachePath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) {
        throw error;
      }
      if (!await hasCachedPackage(cachePath)) throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function loadFallback() {
  const user = createHash("sha256").update(homedir()).digest("hex").slice(0, 16);
  const cacheRoot = join2(tmpdir(), `architecture-companion-typescript-${user}`);
  await mkdir(cacheRoot, { recursive: true, mode: 448 });
  const cacheStat = await lstat(cacheRoot);
  if (!cacheStat.isDirectory() || process.getuid && cacheStat.uid !== process.getuid()) {
    throw new Error(`Unsafe TypeScript temporary cache directory: ${cacheRoot}`);
  }
  if (process.platform !== "win32") await chmod(cacheRoot, 448);
  const cachePath = join2(cacheRoot, version);
  if (!await hasCachedPackage(cachePath)) {
    let installation = installations.get(cachePath);
    if (!installation) {
      installation = installFallback(cacheRoot, cachePath).finally(() => installations.delete(cachePath));
      installations.set(cachePath, installation);
    }
    await installation;
  }
  return require2(join2(cachePath, "node_modules/typescript"));
}
async function loadTypeScript(scopePath) {
  const targetRequire = createRequire(resolve2(scopePath, "package.json"));
  try {
    targetRequire.resolve("typescript/package.json");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return loadFallback();
    }
    throw error;
  }
  return targetRequire("typescript");
}

// src/plugins/artifact-generators/react-component-structure/analysis/build-component-graph.ts
function createComponentGraphBuilder(ts) {
  function formatDiagnostic(diagnostic) {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  }
  async function readCompilerOptions(scopePath, tsconfigPath) {
    const candidatePath = resolve3(scopePath, tsconfigPath ?? "tsconfig.json");
    let canonicalPath;
    try {
      canonicalPath = await realpath2(candidatePath);
    } catch (error) {
      if (!isMissingPathError(error) || tsconfigPath !== void 0) throw error;
    }
    let options = {};
    if (canonicalPath) {
      if (!isPathInside(scopePath, canonicalPath)) {
        throw new Error(`TypeScript config must stay inside the base: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      if (!(await lstat2(canonicalPath)).isFile()) {
        throw new Error(`TypeScript config must be a file: ${tsconfigPath ?? "tsconfig.json"}`);
      }
      const config = ts.readConfigFile(canonicalPath, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${canonicalPath}: ${formatDiagnostic(config.error)}`);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve3(canonicalPath, ".."));
      if (parsed.errors.length > 0) {
        throw new Error(`Cannot parse ${canonicalPath}: ${parsed.errors.map(formatDiagnostic).join("\n")}`);
      }
      options = parsed.options;
    }
    return {
      ...options,
      allowJs: true,
      checkJs: false,
      composite: false,
      incremental: false,
      jsx: options.jsx ?? ts.JsxEmit.Preserve,
      module: options.module ?? ts.ModuleKind.ESNext,
      // Bundler resolution requires module ES2015+ or preserve; a tsconfig that
      // pins an older module (for example commonjs) must fall back to Node10.
      moduleResolution: options.moduleResolution ?? (options.module !== void 0 && options.module < ts.ModuleKind.ES2015 ? ts.ModuleResolutionKind.Node10 : ts.ModuleResolutionKind.Bundler),
      noEmit: true,
      skipLibCheck: true,
      target: options.target ?? ts.ScriptTarget.ESNext
    };
  }
  function unwrapExpression(expression) {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    }
    return current;
  }
  function collectReturnExpressions(body) {
    if (!ts.isBlock(body)) return [body];
    const expressions = [];
    function visit(node) {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node)) {
        if (node.expression) expressions.push(node.expression);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(body);
    return expressions;
  }
  function getImportModuleSpecifier(symbol) {
    for (const declaration of symbol?.declarations ?? []) {
      const candidate = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent : ts.isNamespaceImport(declaration) ? declaration.parent.parent : ts.isImportClause(declaration) ? declaration.parent : void 0;
      if (candidate && ts.isImportDeclaration(candidate) && ts.isStringLiteral(candidate.moduleSpecifier)) {
        return candidate.moduleSpecifier.text;
      }
    }
    return void 0;
  }
  function getImportedName(symbol) {
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
      if (ts.isImportClause(declaration)) return "default";
      if (ts.isNamespaceImport(declaration)) return "*";
    }
    return void 0;
  }
  function isCreateElementCall(node, checker) {
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrapExpression(node.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text !== "createElement") return false;
      const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
      return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
    }
    if (!ts.isIdentifier(callee)) return false;
    const symbol = checker.getSymbolAtLocation(callee);
    return getImportModuleSpecifier(symbol) === "react" && getImportedName(symbol) === "createElement";
  }
  function isArrayRenderingMethodCall(call, checker) {
    const callee = unwrapExpression(call.expression);
    if (!ts.isPropertyAccessExpression(callee) || !["flatMap", "map"].includes(callee.name.text)) return false;
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration) return false;
    return /^lib\..*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName));
  }
  function containsReactOutput(expression, checker) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped) || ts.isJsxFragment(unwrapped)) return true;
    if (ts.isCallExpression(unwrapped)) {
      if (isCreateElementCall(unwrapped, checker)) return true;
      if (!isArrayRenderingMethodCall(unwrapped, checker)) return false;
      return unwrapped.arguments.some(
        (argument) => (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && collectReturnExpressions(argument.body).some((returned) => containsReactOutput(returned, checker))
      );
    }
    if (ts.isConditionalExpression(unwrapped)) {
      return containsReactOutput(unwrapped.whenTrue, checker) || containsReactOutput(unwrapped.whenFalse, checker);
    }
    if (ts.isBinaryExpression(unwrapped)) return containsReactOutput(unwrapped.right, checker);
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return unwrapped.elements.some((element) => ts.isExpression(element) && containsReactOutput(element, checker));
    }
    return false;
  }
  function isReactWrapperCall(call, checker) {
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const symbol = checker.getSymbolAtLocation(callee);
      return getImportModuleSpecifier(symbol) === "react" && ["forwardRef", "memo"].includes(getImportedName(symbol) ?? "");
    }
    if (!ts.isPropertyAccessExpression(callee) || !["forwardRef", "memo"].includes(callee.name.text)) return false;
    const receiver = leftmostIdentifier(callee.expression) ?? callee.expression;
    return isReactSymbol(checker.getSymbolAtLocation(receiver), checker);
  }
  function unwrapFunction(initializer, checker) {
    const expression = unwrapExpression(initializer);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
    if (!ts.isCallExpression(expression) || expression.arguments.length === 0 || !isReactWrapperCall(expression, checker)) {
      return void 0;
    }
    return unwrapFunction(expression.arguments.at(0), checker);
  }
  function isComponentName(name) {
    return /^[A-Z]/.test(name);
  }
  function defaultExportName(sourceFile) {
    const fileName = basename(sourceFile.fileName, extname2(sourceFile.fileName));
    const words = fileName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    const name = words.map((word) => `${word.at(0)?.toUpperCase()}${word.slice(1)}`).join("");
    return name || "DefaultExport";
  }
  function createComponentId(relativePath, identityName) {
    return `component:${relativePath}#${identityName}`;
  }
  function isDefaultExportDeclaration(declaration) {
    return declaration.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  }
  function defaultExportSymbol(sourceFile, checker) {
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    return moduleSymbol ? checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === "default") : void 0;
  }
  function collectComponentDefinitions(sourceFiles, scopePath, checker) {
    const definitions = [];
    const definitionIds = /* @__PURE__ */ new Set();
    function addDefinition(sourceFile, declaration, name, symbol, functionLike, renderRoots, body, classComponent, identityName = name) {
      if (!isComponentName(name)) return;
      if (renderRoots.length === 0 || !renderRoots.some((root) => containsReactOutput(root, checker))) return;
      const relativePath = toPosixPath(relative3(scopePath, sourceFile.fileName));
      const id = createComponentId(relativePath, identityName);
      if (definitionIds.has(id)) throw new Error(`Duplicate React component identity: ${id}`);
      definitionIds.add(id);
      definitions.push({
        id,
        name,
        filePath: sourceFile.fileName,
        relativePath,
        declaration,
        symbol,
        parameters: functionLike?.parameters ?? [],
        renderRoots,
        body,
        classComponent
      });
    }
    for (const sourceFile of sourceFiles) {
      for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.body) {
          const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
          const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : void 0);
          if (!name) continue;
          const roots = collectReturnExpressions(statement.body);
          addDefinition(
            sourceFile,
            statement,
            name,
            statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
            statement,
            roots,
            statement.body,
            false,
            anonymousDefault ? "default" : name
          );
          continue;
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
            const functionLike = unwrapFunction(declaration.initializer, checker);
            if (!functionLike || !functionLike.body) continue;
            addDefinition(
              sourceFile,
              declaration,
              declaration.name.text,
              checker.getSymbolAtLocation(declaration.name),
              functionLike,
              collectReturnExpressions(functionLike.body),
              functionLike.body,
              false
            );
          }
          continue;
        }
        if (ts.isClassDeclaration(statement)) {
          const anonymousDefault = !statement.name && isDefaultExportDeclaration(statement);
          const name = statement.name?.text ?? (anonymousDefault ? defaultExportName(sourceFile) : void 0);
          if (!name) continue;
          const renderMethod = statement.members.find(
            (member) => ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === "render" && !!member.body
          );
          if (!renderMethod?.body) continue;
          addDefinition(
            sourceFile,
            statement,
            name,
            statement.name ? checker.getSymbolAtLocation(statement.name) : defaultExportSymbol(sourceFile, checker),
            void 0,
            collectReturnExpressions(renderMethod.body),
            renderMethod.body,
            true,
            anonymousDefault ? "default" : name
          );
          continue;
        }
        if (ts.isExportAssignment(statement)) {
          const functionLike = unwrapFunction(statement.expression, checker);
          if (!functionLike?.body) continue;
          const name = defaultExportName(sourceFile);
          addDefinition(
            sourceFile,
            statement,
            name,
            defaultExportSymbol(sourceFile, checker),
            functionLike,
            collectReturnExpressions(functionLike.body),
            functionLike.body,
            false,
            "default"
          );
        }
      }
    }
    return definitions.toSorted((left, right) => left.id.localeCompare(right.id));
  }
  function canonicalSymbol(symbol, checker) {
    if (!symbol) return void 0;
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
    return checker.getAliasedSymbol(symbol);
  }
  function resolveDefinition(symbol, checker, definitionsBySymbol, definitionsByDeclaration, visited = /* @__PURE__ */ new Set()) {
    if (!symbol || visited.has(symbol)) return void 0;
    const nextVisited = new Set(visited).add(symbol);
    const canonical = canonicalSymbol(symbol, checker);
    const direct = canonical ? definitionsBySymbol.get(canonical) : void 0;
    if (direct) return direct;
    for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
      const definition = definitionsByDeclaration.get(declaration);
      if (definition) return definition;
      if (ts.isExportAssignment(declaration)) {
        const expression = unwrapExpression(declaration.expression);
        if (ts.isCallExpression(expression) && isReactWrapperCall(expression, checker) && expression.arguments.length > 0) {
          const wrapped = unwrapExpression(expression.arguments.at(0));
          if (ts.isIdentifier(wrapped) || ts.isPropertyAccessExpression(wrapped)) {
            const aliasedDefinition = resolveDefinition(
              checker.getSymbolAtLocation(wrapped),
              checker,
              definitionsBySymbol,
              definitionsByDeclaration,
              nextVisited
            );
            if (aliasedDefinition) return aliasedDefinition;
          }
        }
        continue;
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer)) {
          const aliasedDefinition = resolveDefinition(
            checker.getSymbolAtLocation(initializer),
            checker,
            definitionsBySymbol,
            definitionsByDeclaration,
            nextVisited
          );
          if (aliasedDefinition) return aliasedDefinition;
        }
      }
    }
    return void 0;
  }
  function leftmostIdentifier(expression) {
    if (ts.isIdentifier(expression)) return expression;
    if (ts.isPropertyAccessExpression(expression)) return leftmostIdentifier(expression.expression);
    if (ts.isJsxNamespacedName(expression)) return leftmostIdentifier(expression.namespace);
    return void 0;
  }
  function externalPackageName(moduleSpecifier) {
    if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/") || moduleSpecifier.startsWith("#")) {
      return void 0;
    }
    if (moduleSpecifier.startsWith("@")) return moduleSpecifier.split("/").slice(0, 2).join("/");
    return moduleSpecifier.split("/").at(0);
  }
  function externalPackageNameFromFile(fileName) {
    const normalized = toPosixPath(fileName);
    const marker = "/node_modules/";
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const modulePath = normalized.slice(markerIndex + marker.length);
      if (modulePath.startsWith("@")) return modulePath.split("/").slice(0, 2).join("/");
      const packageName = modulePath.split("/").at(0);
      return packageName && !packageName.startsWith(".") ? packageName : void 0;
    }
    let directory = resolve3(fileName, "..");
    while (true) {
      const manifestPath = ts.findConfigFile(directory, ts.sys.fileExists, "package.json");
      if (!manifestPath) return void 0;
      const { config } = ts.readConfigFile(manifestPath, ts.sys.readFile);
      if (typeof config?.name === "string") return config.name;
      const parent = resolve3(manifestPath, "../..");
      if (parent === resolve3(manifestPath, "..")) return void 0;
      directory = parent;
    }
  }
  function hasExternalDeclaration(symbol, context) {
    const canonical = canonicalSymbol(symbol, context.checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some(
      (declaration) => context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile())
    );
  }
  function isReactSymbol(symbol, checker) {
    if (getImportModuleSpecifier(symbol) === "react") return true;
    const canonical = canonicalSymbol(symbol, checker);
    return (canonical?.declarations ?? symbol?.declarations ?? []).some((declaration) => {
      const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
      return packageName === "react" || packageName === "@types/react";
    });
  }
  function declarationName(symbol, checker) {
    const canonical = canonicalSymbol(symbol, checker);
    for (const declaration of canonical?.declarations ?? []) {
      if ((ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) && declaration.name && ts.isIdentifier(declaration.name)) {
        return declaration.name.text;
      }
    }
    return canonical && canonical.name !== "default" && !canonical.name.startsWith('"') ? canonical.name : void 0;
  }
  function resolveReferenceMembers(symbol, location, names, checker) {
    const members = [];
    let type = checker.getTypeOfSymbolAtLocation(symbol, location);
    for (const name of names) {
      const member = checker.getPropertyOfType(type, name);
      const nextType = member ? checker.getTypeOfSymbolAtLocation(member, location) : checker.getIndexInfosOfType(type).find(({ keyType }) => checker.isTypeAssignableTo(checker.getStringLiteralType(name), keyType))?.type;
      if (!nextType) return void 0;
      members.push({ name, symbol: member, type: nextType });
      type = nextType;
    }
    return members;
  }
  function moduleBinding(symbol) {
    for (const declaration of symbol.declarations ?? []) {
      const candidate = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent : ts.isNamespaceImport(declaration) ? declaration.parent.parent : ts.isImportClause(declaration) ? declaration.parent : ts.isExportSpecifier(declaration) ? declaration.parent.parent : ts.isNamespaceExport(declaration) ? declaration.parent : void 0;
      if (!candidate || !ts.isImportDeclaration(candidate) && !ts.isExportDeclaration(candidate) || !candidate.moduleSpecifier || !ts.isStringLiteral(candidate.moduleSpecifier)) {
        continue;
      }
      const importedName = ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : ts.isImportClause(declaration) ? "default" : "*";
      return { moduleSpecifier: candidate.moduleSpecifier, importedName };
    }
    return void 0;
  }
  function symbolAliasChain(symbol, checker) {
    const chain = [];
    const visited = /* @__PURE__ */ new Set();
    let current = symbol;
    while (current && !visited.has(current)) {
      chain.push(current);
      visited.add(current);
      current = (current.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getImmediateAliasedSymbol(current) : void 0;
    }
    return chain;
  }
  function externalPackageForSymbol(symbol, checker) {
    const canonical = canonicalSymbol(symbol, checker);
    for (const declaration of canonical?.declarations ?? symbol.declarations ?? []) {
      const packageName = externalPackageNameFromFile(declaration.getSourceFile().fileName);
      if (packageName) return packageName;
    }
    return void 0;
  }
  function externalSymbolOrigin(symbol, context, namespaceMembers = []) {
    const checker = context.checker;
    const chain = symbolAliasChain(symbol, checker);
    const canonical = canonicalSymbol(chain.at(-1), checker);
    const namespaceMember = namespaceMembers.at(0);
    const namespaceBinding = chain.map(moduleBinding).find((binding) => binding?.importedName === "*");
    const member = namespaceBinding ? namespaceMember?.symbol : void 0;
    const selected = canonicalSymbol(member, checker);
    const externalSymbol = selected?.declarations?.length ? selected : canonical;
    if (!externalSymbol?.declarations?.length) return void 0;
    const originFromBinding = (binding, visited = /* @__PURE__ */ new Set()) => {
      if (visited.has(binding.moduleSpecifier)) return void 0;
      const sourceFile = binding.moduleSpecifier.getSourceFile();
      const resolved = ts.resolveModuleName(
        binding.moduleSpecifier.text,
        sourceFile.fileName,
        context.program.getCompilerOptions(),
        context.host,
        void 0,
        void 0,
        context.program.getModeForUsageLocation(sourceFile, binding.moduleSpecifier)
      ).resolvedModule;
      if (resolved?.isExternalLibraryImport) {
        const packageName2 = externalPackageName(binding.moduleSpecifier.text);
        if (packageName2) return { packageName: packageName2, importedName: binding.importedName, symbol: externalSymbol };
      }
      const moduleSymbol = checker.getSymbolAtLocation(binding.moduleSpecifier);
      const nextVisited = new Set(visited).add(binding.moduleSpecifier);
      for (const declaration of moduleSymbol?.declarations ?? []) {
        if (!ts.isSourceFile(declaration)) continue;
        const hasExplicitExport = declaration.statements.some(
          (statement) => ts.isExportDeclaration(statement) && statement.exportClause && (ts.isNamespaceExport(statement.exportClause) ? statement.exportClause.name.text === binding.importedName : statement.exportClause.elements.some((member2) => member2.name.text === binding.importedName))
        );
        if (hasExplicitExport) continue;
        for (const statement of declaration.statements) {
          if (!ts.isExportDeclaration(statement) || statement.exportClause || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
          }
          const exportedModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
          const exported = exportedModule ? checker.getExportsOfModule(exportedModule).find((member2) => member2.name === binding.importedName) : void 0;
          if (canonicalSymbol(exported, checker) !== externalSymbol) continue;
          const origin = originFromBinding(
            { moduleSpecifier: statement.moduleSpecifier, importedName: binding.importedName },
            nextVisited
          );
          if (origin) return origin;
        }
      }
      return void 0;
    };
    for (const candidate of chain) {
      const binding = moduleBinding(candidate);
      const origin = binding ? originFromBinding(
        binding.importedName === "*" && namespaceMember ? { ...binding, importedName: namespaceMember.name } : binding
      ) : void 0;
      if (origin) return binding?.importedName === "*" ? { ...origin, importedName: "*" } : origin;
    }
    if (member) {
      const origin = externalSymbolOrigin(member, context, namespaceMembers.slice(1));
      if (origin) return { ...origin, namespaceDepth: (origin.namespaceDepth ?? 0) + 1 };
    }
    if (!hasExternalDeclaration(externalSymbol, context)) return void 0;
    const packageName = externalPackageForSymbol(externalSymbol, checker);
    return packageName ? { packageName, symbol: externalSymbol } : void 0;
  }
  function externalReferencePath(expression) {
    if (ts.isJsxNamespacedName(expression)) return void 0;
    let current = unwrapExpression(expression);
    const members = [];
    while (ts.isPropertyAccessExpression(current)) {
      members.unshift(current.name.text);
      current = unwrapExpression(current.expression);
    }
    return ts.isIdentifier(current) ? { root: current, members } : void 0;
  }
  function resolveExternalReference(expression, context, symbolOverride, visitedSymbols = /* @__PURE__ */ new Set(), remainingMembers = []) {
    const path = externalReferencePath(expression);
    if (!path) return void 0;
    const symbol = symbolOverride ?? context.checker.getSymbolAtLocation(path.root);
    if (!symbol || visitedSymbols.has(symbol)) return void 0;
    const members = [...path.members, ...remainingMembers];
    const selectedMembers = resolveReferenceMembers(symbol, expression, members, context.checker);
    if (!selectedMembers) return void 0;
    const origin = externalSymbolOrigin(symbol, context, selectedMembers);
    if (origin) {
      return { origin, members: selectedMembers.slice(origin.namespaceDepth ?? 0), localName: path.root.text };
    }
    const reference = localImmutableReference(symbol, context, visitedSymbols);
    if (!reference) return void 0;
    const resolved = /* @__PURE__ */ new Map();
    for (const initializer of reference.initializers) {
      const target = resolveExternalReference(initializer, context, void 0, reference.visitedSymbols, members);
      if (!target) continue;
      resolved.set(externalReferenceIdentity(target, context.checker).id, target);
    }
    return resolved.size === 1 ? [...resolved.values()].at(0) : void 0;
  }
  function externalReferenceIdentity(reference, checker) {
    const { origin, members, localName } = reference;
    const canonicalName = declarationName(origin.symbol, checker);
    const rootName = origin.importedName === "*" ? void 0 : origin.importedName === "default" ? canonicalName ?? "default" : origin.importedName ?? canonicalName;
    const path = members.map(({ name }) => name);
    const title = rootName ? [rootName, ...path].join(".") : path.length > 0 ? path.join(".") : canonicalName ?? localName;
    return { id: `external:${origin.packageName}#${title}`, title, externalPackage: origin.packageName };
  }
  function isIntrinsicJsxTag(tagName) {
    return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text);
  }
  function targetForReference(expression, context, symbolOverride) {
    const checker = context.checker;
    const external = resolveExternalReference(expression, context, symbolOverride);
    if (!external) {
      const symbol = symbolOverride ?? checker.getSymbolAtLocation(expression);
      const definition = resolveDefinition(
        symbol,
        checker,
        context.definitionsBySymbol,
        context.definitionsByDeclaration
      );
      return definition ? { id: definition.id, title: definition.name, definition } : void 0;
    }
    const target = externalReferenceIdentity(external, checker);
    if (target.externalPackage === "react" && /(?:^|\.)Fragment$/.test(target.title)) return void 0;
    const existing = context.externalTargets.get(target.id);
    if (existing) return existing;
    context.externalTargets.set(target.id, target);
    return target;
  }
  function componentUseId(ownerId, node, targetId, scopePath) {
    return [
      ownerId,
      toPosixPath(relative3(scopePath, node.getSourceFile().fileName)),
      node.pos,
      node.end,
      targetId
    ].join("\0");
  }
  function ensureComponentUse(ownerId, node, target, context) {
    const id = componentUseId(ownerId, node, target.id, context.scopePath);
    const existing = context.uses.get(id);
    if (existing) return existing;
    const use = { id, ownerId, target, suppliedValues: [] };
    context.uses.set(id, use);
    return use;
  }
  function addDirectUse(context, use) {
    const existing = context.directUseIdsByOwner.get(use.ownerId) ?? [];
    if (!existing.includes(use.id)) existing.push(use.id);
    context.directUseIdsByOwner.set(use.ownerId, existing);
  }
  function symbolForBindingName(name, checker) {
    return ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : void 0;
  }
  function isThisPropsExpression(expression) {
    const unwrapped = unwrapExpression(expression);
    return ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "props" && unwrapped.expression.kind === ts.SyntaxKind.ThisKeyword;
  }
  function createPropBindings(definition, checker) {
    const propsObjects = /* @__PURE__ */ new Set();
    const restObjects = /* @__PURE__ */ new Map();
    const propSymbols = /* @__PURE__ */ new Map();
    function addObjectBinding(pattern, inheritedExclusions) {
      const excluded = new Set(inheritedExclusions);
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          const restSymbol = symbolForBindingName(element.name, checker);
          if (restSymbol) restObjects.set(restSymbol, new Set(excluded));
          continue;
        }
        const propName = element.propertyName?.getText() ?? element.name.getText();
        excluded.add(propName);
        const symbol = symbolForBindingName(element.name, checker);
        if (symbol) propSymbols.set(symbol, propName);
      }
    }
    const firstParameter = definition.parameters.at(0);
    if (firstParameter) {
      if (ts.isIdentifier(firstParameter.name)) {
        const symbol = checker.getSymbolAtLocation(firstParameter.name);
        if (symbol) propsObjects.add(symbol);
      } else if (ts.isObjectBindingPattern(firstParameter.name)) {
        addObjectBinding(firstParameter.name, /* @__PURE__ */ new Set());
      }
    }
    function sourceExclusions(expression) {
      const unwrapped = unwrapExpression(expression);
      if (isThisPropsExpression(unwrapped)) return /* @__PURE__ */ new Set();
      if (!ts.isIdentifier(unwrapped)) return void 0;
      const symbol = checker.getSymbolAtLocation(unwrapped);
      if (!symbol) return void 0;
      if (propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
      return restObjects.get(symbol);
    }
    function incomingProp(expression) {
      const unwrapped = unwrapExpression(expression);
      if (ts.isIdentifier(unwrapped)) {
        const symbol = checker.getSymbolAtLocation(unwrapped);
        return symbol ? propSymbols.get(symbol) : void 0;
      }
      if (ts.isPropertyAccessExpression(unwrapped)) {
        const baseExclusions = sourceExclusions(unwrapped.expression);
        if (baseExclusions && !baseExclusions.has(unwrapped.name.text)) return unwrapped.name.text;
      }
      if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression)) {
        const baseExclusions = sourceExclusions(unwrapped.expression);
        if (baseExclusions && !baseExclusions.has(unwrapped.argumentExpression.text)) {
          return unwrapped.argumentExpression.text;
        }
      }
      return void 0;
    }
    if (definition.body && ts.isBlock(definition.body)) {
      let visit2 = function(node) {
        if (node !== definition.body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const exclusions = sourceExclusions(node.initializer);
          if (ts.isObjectBindingPattern(node.name) && exclusions) {
            addObjectBinding(node.name, exclusions);
          } else if (ts.isIdentifier(node.name)) {
            const targetSymbol = checker.getSymbolAtLocation(node.name);
            const propName = incomingProp(node.initializer);
            if (targetSymbol && propName) propSymbols.set(targetSymbol, propName);
            if (targetSymbol && exclusions) {
              if (exclusions.size === 0) propsObjects.add(targetSymbol);
              else restObjects.set(targetSymbol, exclusions);
            }
          }
        }
        ts.forEachChild(node, visit2);
      };
      var visit = visit2;
      visit2(definition.body);
    }
    return { propsObjects, restObjects, propSymbols, classComponent: definition.classComponent };
  }
  function getIncomingProp(expression, bindings, checker) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = checker.getSymbolAtLocation(unwrapped);
      return symbol ? bindings.propSymbols.get(symbol) : void 0;
    }
    function exclusionsFor(source) {
      const candidate = unwrapExpression(source);
      if (bindings.classComponent && isThisPropsExpression(candidate)) return /* @__PURE__ */ new Set();
      if (!ts.isIdentifier(candidate)) return void 0;
      const symbol = checker.getSymbolAtLocation(candidate);
      if (!symbol) return void 0;
      if (bindings.propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
      return bindings.restObjects.get(symbol);
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const exclusions = exclusionsFor(unwrapped.expression);
      if (exclusions && !exclusions.has(unwrapped.name.text)) return unwrapped.name.text;
    }
    if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression)) {
      const exclusions = exclusionsFor(unwrapped.expression);
      if (exclusions && !exclusions.has(unwrapped.argumentExpression.text)) return unwrapped.argumentExpression.text;
    }
    return void 0;
  }
  function getSpreadExclusions(expression, bindings, checker) {
    const unwrapped = unwrapExpression(expression);
    if (bindings.classComponent && isThisPropsExpression(unwrapped)) return /* @__PURE__ */ new Set();
    if (!ts.isIdentifier(unwrapped)) return void 0;
    const symbol = checker.getSymbolAtLocation(unwrapped);
    if (!symbol) return void 0;
    if (bindings.propsObjects.has(symbol)) return /* @__PURE__ */ new Set();
    return bindings.restObjects.get(symbol);
  }
  function addExactRule(rules, propName, rule) {
    const existing = rules.exact.get(propName) ?? [];
    const key = JSON.stringify(rule);
    if (!existing.some((candidate) => JSON.stringify(candidate) === key)) existing.push(rule);
    rules.exact.set(propName, existing);
  }
  function jsxAttributeExpression(attribute) {
    if (!attribute.initializer) return void 0;
    if (ts.isJsxExpression(attribute.initializer)) return attribute.initializer.expression;
    if (ts.isJsxElement(attribute.initializer) || ts.isJsxSelfClosingElement(attribute.initializer)) {
      return attribute.initializer;
    }
    return void 0;
  }
  function isEffectiveJsxChild(child) {
    if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
    if (ts.isJsxExpression(child)) return !!child.expression;
    return true;
  }
  function propertyNameText(name) {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
    return void 0;
  }
  function localVariableReference(expression, context, visitedSymbols, symbolOverride) {
    const unwrapped = unwrapExpression(expression);
    if (!symbolOverride && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return void 0;
    const referenceSymbol = symbolOverride ?? context.checker.getSymbolAtLocation(unwrapped);
    const reference = referenceSymbol ? localImmutableReference(referenceSymbol, context, visitedSymbols) : void 0;
    if (!reference) return void 0;
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const root = externalReferencePath(unwrapped)?.root;
      const rootSymbol = root ? context.checker.getSymbolAtLocation(root) : void 0;
      if (rootSymbol && externalSymbolOrigin(rootSymbol, context)) return void 0;
      if (resolveExternalReference(unwrapped, context, void 0, visitedSymbols)) return void 0;
    }
    if (resolveDefinition(referenceSymbol, context.checker, context.definitionsBySymbol, context.definitionsByDeclaration)) {
      return void 0;
    }
    return reference;
  }
  function localImmutableReference(referenceSymbol, context, visitedSymbols) {
    if (externalSymbolOrigin(referenceSymbol, context)) return void 0;
    const symbol = canonicalSymbol(referenceSymbol, context.checker);
    if (!symbol || visitedSymbols.has(symbol)) return void 0;
    const initializers = (symbol.declarations ?? []).flatMap((declaration) => {
      if (context.program.isSourceFileFromExternalLibrary(declaration.getSourceFile())) {
        return [];
      }
      if (ts.isExportAssignment(declaration)) return [declaration.expression];
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0) {
        return [];
      }
      return [declaration.initializer];
    });
    if (initializers.length === 0) return void 0;
    return { initializers, visitedSymbols: new Set(visitedSymbols).add(symbol) };
  }
  function resolveAliasedValues(expression, context, visitedSymbols = /* @__PURE__ */ new Set(), symbolOverride) {
    const unwrapped = unwrapExpression(expression);
    const property = symbolOverride ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
    if (property) {
      return resolveAliasedValues(property.value, context, visitedSymbols, property.valueSymbol);
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols, symbolOverride);
    if (!reference) return [unwrapped];
    return reference.initializers.flatMap(
      (initializer) => resolveAliasedValues(initializer, context, reference.visitedSymbols)
    );
  }
  function collectStaticObjectProperties(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const values2 = /* @__PURE__ */ new Map();
      let hasUnknownSpread2 = false;
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) {
          const propName = propertyNameText(property.name);
          if (propName) values2.set(propName, { propName, value: property.initializer });
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const propName = propertyNameText(property.name);
          if (propName) {
            values2.set(propName, {
              propName,
              value: property.name,
              valueSymbol: context.checker.getShorthandAssignmentValueSymbol(property)
            });
          }
        } else if (ts.isSpreadAssignment(property)) {
          const spread = collectStaticObjectProperties(property.expression, context, visitedSymbols);
          if (spread.hasUnknownSpread) {
            values2.clear();
            hasUnknownSpread2 = true;
          }
          for (const [propName, value] of spread.values) values2.set(propName, value);
        }
      }
      return { hasUnknownSpread: hasUnknownSpread2, values: values2 };
    }
    const reference = localVariableReference(unwrapped, context, visitedSymbols);
    if (!reference) return { hasUnknownSpread: true, values: /* @__PURE__ */ new Map() };
    const values = /* @__PURE__ */ new Map();
    let hasUnknownSpread = false;
    for (const initializer of reference.initializers) {
      const resolved = collectStaticObjectProperties(initializer, context, reference.visitedSymbols);
      if (resolved.hasUnknownSpread) {
        values.clear();
        hasUnknownSpread = true;
      }
      for (const [propName, value] of resolved.values) values.set(propName, value);
    }
    return { hasUnknownSpread, values };
  }
  function staticObjectPropertyValues(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    return [...collectStaticObjectProperties(expression, context, visitedSymbols).values.values()];
  }
  function staticObjectPropertyValue(expression, context, visitedSymbols = /* @__PURE__ */ new Set()) {
    const unwrapped = unwrapExpression(expression);
    const property = ts.isPropertyAccessExpression(unwrapped) ? { name: unwrapped.name.text, source: unwrapped.expression } : ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && ts.isStringLiteralLike(unwrapped.argumentExpression) ? { name: unwrapped.argumentExpression.text, source: unwrapped.expression } : void 0;
    if (!property) return void 0;
    return staticObjectPropertyValues(property.source, context, visitedSymbols).find(
      ({ propName }) => propName === property.name
    );
  }
  function analyzeConsumerRules(definition, context, bindings) {
    const rules = { exact: /* @__PURE__ */ new Map(), spreads: [] };
    const mutableSpreads = rules.spreads;
    function terminal(propName, kind) {
      addExactRule(rules, propName, { type: "terminal", kind });
    }
    function removeForwardingToProp(targetUseId, targetPropName) {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.filter(
            (rule) => rule.type !== "forward" || rule.targetUseId !== targetUseId || rule.targetPropName !== targetPropName
          )
        );
      }
      for (const [index, spread] of mutableSpreads.entries()) {
        if (spread.targetUseId !== targetUseId) continue;
        mutableSpreads[index] = {
          ...spread,
          excludedProps: new Set(spread.excludedProps).add(targetPropName)
        };
      }
    }
    function removeForwardingOverriddenBySpread(targetUseId, excludedProps) {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.filter(
            (rule) => rule.type !== "forward" || rule.targetUseId !== targetUseId || excludedProps.has(rule.targetPropName)
          )
        );
      }
    }
    function clearForwardingToTarget(targetUseId) {
      for (const [incomingPropName, existing] of rules.exact) {
        rules.exact.set(
          incomingPropName,
          existing.filter((rule) => rule.type !== "forward" || rule.targetUseId !== targetUseId)
        );
      }
      for (let index = mutableSpreads.length - 1; index >= 0; index -= 1) {
        if (mutableSpreads[index]?.targetUseId === targetUseId) mutableSpreads.splice(index, 1);
      }
    }
    function collectInvokedRenderProps(expression, traverseRootFunction) {
      const props = /* @__PURE__ */ new Set();
      function visit(node, isRoot) {
        if (ts.isFunctionLike(node) && !(isRoot && traverseRootFunction)) return;
        if (ts.isCallExpression(node)) {
          const propName = getIncomingProp(node.expression, bindings, context.checker);
          if (propName) props.add(propName);
        }
        ts.forEachChild(node, (child) => visit(child, false));
      }
      visit(expression, true);
      return [...props];
    }
    function analyzeRenderPropInvocations(expression) {
      for (const propName of collectInvokedRenderProps(expression, false)) terminal(propName, "render-prop");
    }
    function collectForwardedProps(expression, symbolOverride) {
      const props = /* @__PURE__ */ new Set();
      function collect(candidate, visitedSymbols, candidateSymbol) {
        const unwrapped = unwrapExpression(candidate);
        const directProp = candidateSymbol ? bindings.propSymbols.get(candidateSymbol) : getIncomingProp(unwrapped, bindings, context.checker);
        if (directProp) {
          props.add(directProp);
          return;
        }
        const property = candidateSymbol ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
        if (property) {
          collect(property.value, visitedSymbols, property.valueSymbol);
          return;
        }
        if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
          for (const propName of collectInvokedRenderProps(unwrapped, true)) props.add(propName);
          return;
        }
        if (ts.isObjectLiteralExpression(unwrapped)) {
          for (const property2 of staticObjectPropertyValues(unwrapped, context)) {
            collect(property2.value, visitedSymbols, property2.valueSymbol);
          }
          return;
        }
        if (ts.isArrayLiteralExpression(unwrapped)) {
          for (const element of unwrapped.elements) {
            if (ts.isExpression(element)) collect(element, visitedSymbols);
          }
          return;
        }
        const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
        if (!reference) return;
        for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
      }
      collect(expression, /* @__PURE__ */ new Set(), symbolOverride);
      return [...props];
    }
    function collectForwardedSpreadExclusions(expression, visitedSymbols = /* @__PURE__ */ new Set()) {
      const unwrapped = unwrapExpression(expression);
      const direct = getSpreadExclusions(unwrapped, bindings, context.checker);
      if (direct) return [direct];
      if (ts.isObjectLiteralExpression(unwrapped)) {
        return unwrapped.properties.flatMap(
          (property) => ts.isSpreadAssignment(property) ? collectForwardedSpreadExclusions(property.expression, visitedSymbols) : []
        );
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return [];
      return reference.initializers.flatMap(
        (initializer) => collectForwardedSpreadExclusions(initializer, reference.visitedSymbols)
      );
    }
    function analyzeJsxAttributes(attributes, targetUseId, children) {
      for (const property of attributes.properties) {
        if (ts.isJsxAttribute(property)) {
          const targetPropName = property.name.getText();
          if (targetUseId) removeForwardingToProp(targetUseId, targetPropName);
          const expression = jsxAttributeExpression(property);
          if (!expression) continue;
          analyzeRenderPropInvocations(expression);
          if (!targetUseId) continue;
          for (const propName of new Set(collectForwardedProps(expression))) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName
            });
          }
        } else if (targetUseId) {
          const forwardedSpreads = collectForwardedSpreadExclusions(property.expression);
          const staticProperties = collectStaticObjectProperties(property.expression, context);
          if (forwardedSpreads.length === 0 && staticProperties.hasUnknownSpread) {
            clearForwardingToTarget(targetUseId);
          }
          for (const excludedProps of forwardedSpreads) {
            removeForwardingOverriddenBySpread(targetUseId, excludedProps);
            mutableSpreads.push({ excludedProps, targetUseId });
          }
          for (const forwarded of staticProperties.values.values()) {
            removeForwardingToProp(targetUseId, forwarded.propName);
            analyzeRenderPropInvocations(forwarded.value);
            for (const propName of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
              addExactRule(rules, propName, {
                type: "forward",
                targetUseId,
                targetPropName: forwarded.propName
              });
            }
          }
        }
      }
      const effectiveChildren = children.filter(isEffectiveJsxChild);
      if (targetUseId && effectiveChildren.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of effectiveChildren) {
        if (ts.isJsxExpression(child) && child.expression) analyzeRenderPropInvocations(child.expression);
        if (!targetUseId || !ts.isJsxExpression(child) || !child.expression) continue;
        for (const propName of new Set(collectForwardedProps(child.expression))) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children" });
        }
      }
    }
    function analyzeIntrinsicSpreadAttributes(attributes, children) {
      if (children.filter(isEffectiveJsxChild).length > 0) return;
      for (const property of attributes.properties) {
        if (ts.isJsxAttribute(property)) continue;
        for (const excludedProps of collectForwardedSpreadExclusions(property.expression)) {
          if (!excludedProps.has("children")) terminal("children", "node-prop");
        }
      }
    }
    function analyzeRendered(expression) {
      const unwrapped = unwrapExpression(expression);
      const directProp = getIncomingProp(unwrapped, bindings, context.checker);
      if (directProp) {
        terminal(directProp, "node-prop");
        return;
      }
      if (ts.isCallExpression(unwrapped)) {
        const invokedProp = getIncomingProp(unwrapped.expression, bindings, context.checker);
        if (invokedProp) {
          terminal(invokedProp, "render-prop");
          return;
        }
        if (isCreateElementCall(unwrapped, context.checker)) {
          analyzeCreateElement(unwrapped);
          return;
        }
        if (isArrayRenderingMethodCall(unwrapped, context.checker)) {
          for (const argument of unwrapped.arguments) {
            if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
              for (const returned of collectReturnExpressions(argument.body)) analyzeRendered(returned);
            }
          }
        }
        return;
      }
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeJsxChild(child);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        const componentProp = getIncomingProp(opening.tagName, bindings, context.checker);
        if (componentProp) {
          terminal(componentProp, "component-prop");
          return;
        }
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeJsxChild(child);
          analyzeIntrinsicSpreadAttributes(opening.attributes, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        const targetUseId = target ? componentUseId(definition.id, unwrapped, target.id, context.scopePath) : void 0;
        analyzeJsxAttributes(opening.attributes, targetUseId, ts.isJsxElement(unwrapped) ? unwrapped.children : []);
        return;
      }
      if (ts.isConditionalExpression(unwrapped)) {
        analyzeRendered(unwrapped.whenTrue);
        analyzeRendered(unwrapped.whenFalse);
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        analyzeRendered(unwrapped.right);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) analyzeRendered(element);
        }
        return;
      }
      if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
        for (const returned of collectReturnExpressions(unwrapped.body)) analyzeRendered(returned);
      }
    }
    function analyzeJsxChild(child) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
        analyzeRendered(child);
    }
    function analyzeCreateElement(call) {
      const [tagExpression, propsExpression, ...children] = call.arguments;
      if (!tagExpression) return;
      const componentProp = getIncomingProp(tagExpression, bindings, context.checker);
      if (componentProp) {
        terminal(componentProp, "component-prop");
        return;
      }
      if (ts.isStringLiteral(tagExpression)) {
        for (const child of children) analyzeRendered(child);
        return;
      }
      const target = targetForReference(tagExpression, context);
      const targetUseId = target ? componentUseId(definition.id, call, target.id, context.scopePath) : void 0;
      if (propsExpression && targetUseId) {
        for (const excludedProps of collectForwardedSpreadExclusions(propsExpression)) {
          mutableSpreads.push({ excludedProps, targetUseId });
        }
        for (const forwarded of staticObjectPropertyValues(propsExpression, context)) {
          removeForwardingToProp(targetUseId, forwarded.propName);
          analyzeRenderPropInvocations(forwarded.value);
          for (const propName of collectForwardedProps(forwarded.value, forwarded.valueSymbol)) {
            addExactRule(rules, propName, {
              type: "forward",
              targetUseId,
              targetPropName: forwarded.propName
            });
          }
        }
      }
      if (targetUseId && children.length > 0) removeForwardingToProp(targetUseId, "children");
      for (const child of children) {
        analyzeRenderPropInvocations(child);
        if (!targetUseId) continue;
        for (const propName of collectForwardedProps(child)) {
          addExactRule(rules, propName, { type: "forward", targetUseId, targetPropName: "children" });
        }
      }
    }
    for (const root of definition.renderRoots) analyzeRendered(root);
    return rules;
  }
  function relationshipKey(relationship) {
    return [
      relationship.source,
      relationship.target,
      relationship.kind,
      relationship.kind === "direct-render" ? "" : relationship.propName
    ].join("\0");
  }
  function returnedUses(callback, ownerId, context) {
    return collectSuppliedUses(collectReturnExpressions(callback.body), ownerId, context);
  }
  function collectSuppliedUses(expressions, ownerId, context) {
    const uses = /* @__PURE__ */ new Map();
    function collect(expression, visitedSymbols = /* @__PURE__ */ new Set()) {
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) collectChild(child);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) collectChild(child);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          analyzeJsxComponentUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) collect(child);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (target) {
          const use = ensureComponentUse(ownerId, unwrapped, target, context);
          analyzeCreateElementUsage(unwrapped, use, context);
          uses.set(use.id, use);
        }
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            for (const returned of collectReturnExpressions(argument.body)) collect(returned, visitedSymbols);
          }
        }
        return;
      }
      if (ts.isConditionalExpression(unwrapped)) {
        collect(unwrapped.whenTrue);
        collect(unwrapped.whenFalse);
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        collect(unwrapped.right);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) collect(element, visitedSymbols);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
    }
    function collectChild(child) {
      if (ts.isJsxExpression(child) && child.expression) collect(child.expression);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) collect(child);
    }
    for (const expression of expressions) collect(expression);
    return [...uses.values()].toSorted((left, right) => left.id.localeCompare(right.id));
  }
  function componentReferenceUses(expression, ownerId, context, symbolOverride) {
    const uses = /* @__PURE__ */ new Map();
    function collect(candidate, visitedSymbols, candidateSymbol) {
      const unwrapped = unwrapExpression(candidate);
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const property2 of unwrapped.properties) {
          if (ts.isPropertyAssignment(property2)) collect(property2.initializer, visitedSymbols);
          else if (ts.isShorthandPropertyAssignment(property2)) {
            collect(property2.name, visitedSymbols, context.checker.getShorthandAssignmentValueSymbol(property2));
          } else if (ts.isSpreadAssignment(property2)) collect(property2.expression, visitedSymbols);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) {
          if (ts.isExpression(element)) collect(element, visitedSymbols);
        }
        return;
      }
      if (!candidateSymbol && !ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) return;
      const property = candidateSymbol ? void 0 : staticObjectPropertyValue(unwrapped, context, visitedSymbols);
      if (property) {
        collect(property.value, visitedSymbols, property.valueSymbol);
        return;
      }
      const target = targetForReference(unwrapped, context, candidateSymbol);
      const valueSymbol = canonicalSymbol(
        candidateSymbol ?? context.checker.getSymbolAtLocation(unwrapped),
        context.checker
      );
      const valueType = valueSymbol ? context.checker.getTypeOfSymbolAtLocation(valueSymbol, unwrapped) : context.checker.getTypeAtLocation(unwrapped);
      const callable = valueType.getCallSignatures().length + valueType.getConstructSignatures().length > 0;
      const externalName = target?.title.split(".").at(-1);
      if (target && (target.definition || callable && !!externalName && /^[A-Z]/.test(externalName))) {
        const use = ensureComponentUse(ownerId, unwrapped, target, context);
        uses.set(use.id, use);
        return;
      }
      const reference = localVariableReference(unwrapped, context, visitedSymbols, candidateSymbol);
      if (!reference) return;
      for (const initializer of reference.initializers) collect(initializer, reference.visitedSymbols);
    }
    collect(expression, /* @__PURE__ */ new Set(), symbolOverride);
    return [...uses.values()].toSorted((left, right) => left.id.localeCompare(right.id));
  }
  function addSuppliedValue(receiver, propName, kind, targets) {
    if (targets.length === 0) return;
    receiver.suppliedValues.push({
      propName,
      kind,
      targetUseIds: [...new Set(targets.map(({ id }) => id))].toSorted()
    });
  }
  function analyzeSuppliedValue(receiver, propName, expression, context, symbolOverride) {
    const componentUses = componentReferenceUses(expression, receiver.ownerId, context, symbolOverride);
    if (componentUses.length > 0) {
      addSuppliedValue(receiver, propName, "component-prop", componentUses);
      return;
    }
    const values = resolveAliasedValues(expression, context, /* @__PURE__ */ new Set(), symbolOverride);
    const renderUses = /* @__PURE__ */ new Map();
    for (const value of values) {
      if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue;
      for (const use of returnedUses(value, receiver.ownerId, context)) renderUses.set(use.id, use);
    }
    if (renderUses.size > 0) {
      addSuppliedValue(receiver, propName, "render-prop", [...renderUses.values()]);
      return;
    }
    addSuppliedValue(receiver, propName, "node-prop", collectSuppliedUses(values, receiver.ownerId, context));
  }
  function analyzeJsxComponentUsage(element, receiver, context) {
    if (context.analyzedUseIds.has(receiver.id)) return;
    context.analyzedUseIds.add(receiver.id);
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const valuesByProp = /* @__PURE__ */ new Map();
    for (const property of opening.attributes.properties) {
      if (ts.isJsxAttribute(property)) {
        const expression = jsxAttributeExpression(property);
        if (expression)
          valuesByProp.set(property.name.getText(), { propName: property.name.getText(), value: expression });
        continue;
      }
      for (const value of staticObjectPropertyValues(property.expression, context)) {
        valuesByProp.set(value.propName, value);
      }
    }
    for (const { propName, value, valueSymbol } of valuesByProp.values()) {
      analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
    }
    if (ts.isJsxElement(element)) {
      for (const child of element.children) {
        const expression = ts.isJsxExpression(child) ? child.expression : ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child) ? child : void 0;
        if (expression) analyzeSuppliedValue(receiver, "children", expression, context);
      }
    }
  }
  function analyzeCreateElementUsage(call, receiver, context) {
    if (context.analyzedUseIds.has(receiver.id)) return;
    context.analyzedUseIds.add(receiver.id);
    const [, propsExpression, ...children] = call.arguments;
    if (propsExpression) {
      for (const { propName, value, valueSymbol } of staticObjectPropertyValues(propsExpression, context)) {
        analyzeSuppliedValue(receiver, propName, value, context, valueSymbol);
      }
    }
    for (const child of children) analyzeSuppliedValue(receiver, "children", child, context);
  }
  function analyzeDefinitionUsages(definition, context) {
    function analyzeRendered(expression) {
      const unwrapped = unwrapExpression(expression);
      if (ts.isJsxFragment(unwrapped)) {
        for (const child of unwrapped.children) analyzeChild(child);
        return;
      }
      if (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped)) {
        const opening = ts.isJsxElement(unwrapped) ? unwrapped.openingElement : unwrapped;
        if (isIntrinsicJsxTag(opening.tagName)) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child);
          return;
        }
        const target = targetForReference(opening.tagName, context);
        if (!target) {
          if (ts.isJsxElement(unwrapped)) for (const child of unwrapped.children) analyzeChild(child);
          return;
        }
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        analyzeJsxComponentUsage(unwrapped, use, context);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isCreateElementCall(unwrapped, context.checker)) {
        const [tagExpression] = unwrapped.arguments;
        if (!tagExpression) return;
        if (ts.isStringLiteral(tagExpression)) {
          for (const child of unwrapped.arguments.slice(2)) analyzeRendered(child);
          return;
        }
        const target = targetForReference(tagExpression, context);
        if (!target) return;
        const use = ensureComponentUse(definition.id, unwrapped, target, context);
        addDirectUse(context, use);
        analyzeCreateElementUsage(unwrapped, use, context);
        return;
      }
      if (ts.isConditionalExpression(unwrapped)) {
        analyzeRendered(unwrapped.whenTrue);
        analyzeRendered(unwrapped.whenFalse);
        return;
      }
      if (ts.isBinaryExpression(unwrapped)) {
        analyzeRendered(unwrapped.right);
        return;
      }
      if (ts.isArrayLiteralExpression(unwrapped)) {
        for (const element of unwrapped.elements) if (ts.isExpression(element)) analyzeRendered(element);
        return;
      }
      if (ts.isCallExpression(unwrapped) && isArrayRenderingMethodCall(unwrapped, context.checker)) {
        for (const argument of unwrapped.arguments) {
          if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
            for (const returned of collectReturnExpressions(argument.body)) analyzeRendered(returned);
          }
        }
      }
    }
    function analyzeChild(child) {
      if (ts.isJsxExpression(child) && child.expression) analyzeRendered(child.expression);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        analyzeRendered(child);
      }
    }
    for (const root of definition.renderRoots) analyzeRendered(root);
  }
  function resolveConsumerRoutes(receiverUse, propName, kind, rulesByComponentId, context, visited = /* @__PURE__ */ new Set()) {
    const visitKey = `${receiverUse.id}\0${propName}\0${kind}`;
    if (visited.has(visitKey)) return [];
    const nextVisited = new Set(visited).add(visitKey);
    const step = { useId: receiverUse.id, componentId: receiverUse.target.id, propName };
    const rules = rulesByComponentId.get(receiverUse.target.id);
    if (!rules) {
      if (kind === "render-prop" && /^on[A-Z]/.test(propName)) return [];
      return [{ kind, steps: [step] }];
    }
    const candidates = [
      ...rules.exact.get(propName) ?? [],
      ...rules.spreads.filter(({ excludedProps }) => !excludedProps.has(propName)).map(({ targetUseId }) => ({ type: "forward", targetUseId, targetPropName: propName }))
    ];
    const routes = /* @__PURE__ */ new Map();
    for (const rule of candidates) {
      if (rule.type === "terminal") {
        if (rule.kind === kind) {
          const route = { kind, steps: [step] };
          routes.set(JSON.stringify(route), route);
        }
        continue;
      }
      const targetUse = context.uses.get(rule.targetUseId);
      if (!targetUse) continue;
      for (const downstream of resolveConsumerRoutes(
        targetUse,
        rule.targetPropName,
        kind,
        rulesByComponentId,
        context,
        nextVisited
      )) {
        const route = { kind, steps: [step, ...downstream.steps] };
        routes.set(JSON.stringify(route), route);
      }
    }
    return [...routes.values()];
  }
  function relationshipKindLabel(relationship) {
    if (relationship.kind === "direct-render") return relationship.kind;
    const category = relationship.kind === "node-prop" ? "NODE" : relationship.kind === "render-prop" ? "RENDER" : "COMPONENT";
    return `${category} (${relationship.propName})`;
  }
  function relationshipLabel(relationship, definitionsById) {
    if (relationship.kind === "direct-render") return void 0;
    const supplierNames = relationship.supplierIds.map((supplierId) => definitionsById.get(supplierId)?.name ?? supplierId).toSorted();
    return `from ${supplierNames.join(", ")}`;
  }
  function edgeId(relationship) {
    const key = relationship.kind === "direct-render" ? relationshipKey(relationship) : `${relationshipKey(relationship)}\0${relationship.supplierIds.join("\0")}`;
    return `edge:${createHash2("sha256").update(key).digest("hex").slice(0, 16)}`;
  }
  function sourceHref(relativePath) {
    return `source:///${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }
  function matchesComponentPattern(id, title, patterns) {
    return import_micromatch.default.match([title, id], patterns).length > 0;
  }
  function createVisibilityByTarget(definitions, externalTargets, excludeFilePatterns, excludeComponentPatterns) {
    const excludeFileRules = excludeFilePatterns.length > 0 ? (0, import_ignore2.default)().add([...excludeFilePatterns]) : void 0;
    const visibility = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      const hidden = (excludeFileRules?.ignores(definition.relativePath) ?? false) || matchesComponentPattern(definition.id, definition.name, excludeComponentPatterns);
      visibility.set(definition.id, {
        boundaryVisible: !hidden,
        implementationAnalyzed: !hidden
      });
    }
    for (const target of externalTargets.values()) {
      visibility.set(target.id, {
        boundaryVisible: !matchesComponentPattern(target.id, target.title, excludeComponentPatterns),
        implementationAnalyzed: false
      });
    }
    return visibility;
  }
  function sourceDefinitionIds(definitions, uses) {
    const definitionIds = new Set(definitions.map(({ id }) => id));
    const adjacency = new Map(definitions.map(({ id }) => [id, /* @__PURE__ */ new Set()]));
    for (const use of uses.values()) {
      if (definitionIds.has(use.ownerId) && use.target.definition) {
        adjacency.get(use.ownerId)?.add(use.target.id);
      }
    }
    let nextIndex = 0;
    const indices = /* @__PURE__ */ new Map();
    const lowLinks = /* @__PURE__ */ new Map();
    const stack = [];
    const onStack = /* @__PURE__ */ new Set();
    const components = [];
    function connect(componentId) {
      indices.set(componentId, nextIndex);
      lowLinks.set(componentId, nextIndex);
      nextIndex += 1;
      stack.push(componentId);
      onStack.add(componentId);
      for (const targetId of [...adjacency.get(componentId) ?? []].toSorted()) {
        if (!indices.has(targetId)) {
          connect(targetId);
          lowLinks.set(componentId, Math.min(lowLinks.get(componentId), lowLinks.get(targetId)));
        } else if (onStack.has(targetId)) {
          lowLinks.set(componentId, Math.min(lowLinks.get(componentId), indices.get(targetId)));
        }
      }
      if (lowLinks.get(componentId) !== indices.get(componentId)) return;
      const component = [];
      while (stack.length > 0) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === componentId) break;
      }
      components.push(component.toSorted());
    }
    for (const definition of definitions) {
      if (!indices.has(definition.id)) connect(definition.id);
    }
    const componentIndexById = /* @__PURE__ */ new Map();
    components.forEach((component, index) => {
      for (const componentId of component) componentIndexById.set(componentId, index);
    });
    const incoming = /* @__PURE__ */ new Set();
    for (const [sourceId, targetIds] of adjacency) {
      const sourceIndex = componentIndexById.get(sourceId);
      for (const targetId of targetIds) {
        const targetIndex = componentIndexById.get(targetId);
        if (sourceIndex !== void 0 && targetIndex !== void 0 && sourceIndex !== targetIndex)
          incoming.add(targetIndex);
      }
    }
    return components.filter((_, index) => !incoming.has(index)).flat().toSorted();
  }
  function collapseComponentStructure(definitions, context, rulesByComponentId, visibility) {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const visibleInstances = /* @__PURE__ */ new Map();
    const visibleDefinitionIds = /* @__PURE__ */ new Set();
    const relationships = /* @__PURE__ */ new Map();
    function targetVisibility(targetId) {
      return visibility.get(targetId) ?? { boundaryVisible: false, implementationAnalyzed: false };
    }
    function createInstance(id, target, owner) {
      const ancestors = new Map(owner?.ancestors);
      const instance = { id, target, ancestors, uses: /* @__PURE__ */ new Map() };
      ancestors.set(target.id, instance);
      return instance;
    }
    function ensureComponentInstance(parent, use, owner) {
      const existing = parent.uses.get(use.id);
      if (existing) return existing;
      const ancestor = owner.ancestors.get(use.target.id);
      const suffix = createHash2("sha256").update(`${parent.id}\0${use.id}`).digest("hex").slice(0, 16);
      const instance = ancestor ?? createInstance(`${use.target.id}@${suffix}`, use.target, owner);
      parent.uses.set(use.id, instance);
      return instance;
    }
    function addFinalRelationship(relationship) {
      const key = relationshipKey(relationship);
      const existing = relationships.get(key);
      if (!existing || existing.kind === "direct-render" || relationship.kind === "direct-render") {
        relationships.set(key, relationship);
        return;
      }
      relationships.set(key, {
        ...relationship,
        supplierIds: [.../* @__PURE__ */ new Set([...existing.supplierIds, ...relationship.supplierIds])].toSorted()
      });
    }
    function makeVisible(instance) {
      const policy = targetVisibility(instance.target.id);
      if (!policy.boundaryVisible || visibleInstances.has(instance.id)) return;
      visibleInstances.set(instance.id, instance);
      visibleDefinitionIds.add(instance.target.id);
      if (!instance.target.definition || !policy.implementationAnalyzed) return;
      for (const useId of [...context.directUseIdsByOwner.get(instance.target.id) ?? []].toSorted()) {
        const use = context.uses.get(useId);
        if (use) processDirectUse(instance, use);
      }
    }
    function processSuppliedTarget(targetUse, parent, source, owner, kind, propName, trail) {
      const visitKey = [targetUse.id, source.id, kind, propName].join("\0");
      if (trail.has(visitKey)) return;
      const nextTrail = new Set(trail).add(visitKey);
      const instance = ensureComponentInstance(parent, targetUse, owner);
      const policy = targetVisibility(targetUse.target.id);
      if (!policy.boundaryVisible) {
        processUseSupplies(targetUse, instance, source, owner, nextTrail, { kind, propName });
        return;
      }
      makeVisible(instance);
      addFinalRelationship({
        source: source.id,
        target: instance.id,
        kind,
        propName,
        supplierIds: [targetUse.ownerId]
      });
      processUseSupplies(targetUse, instance, instance, owner, nextTrail);
    }
    function processUseSupplies(receiverUse, receiver, fallbackSource, owner, trail = /* @__PURE__ */ new Set(), inherited) {
      const receiverVisible = targetVisibility(receiverUse.target.id).boundaryVisible;
      for (const supplied of receiverUse.suppliedValues) {
        const routes = resolveConsumerRoutes(
          receiverUse,
          supplied.propName,
          supplied.kind,
          rulesByComponentId,
          context
        );
        if (routes.length === 0) continue;
        for (const route of routes) {
          let consumer = receiver;
          let source = fallbackSource;
          let propName = inherited?.propName ?? supplied.propName;
          let visiblePath = receiverVisible;
          for (const [index, step] of route.steps.entries()) {
            if (index > 0) {
              const use = context.uses.get(step.useId);
              consumer = ensureComponentInstance(consumer, use, consumer);
            }
            visiblePath &&= targetVisibility(step.componentId).boundaryVisible;
            if (visiblePath) {
              source = consumer;
              propName = step.propName;
            }
          }
          for (const targetUseId of supplied.targetUseIds) {
            const targetUse = context.uses.get(targetUseId);
            if (targetUse) {
              processSuppliedTarget(targetUse, consumer, source, owner, inherited?.kind ?? route.kind, propName, trail);
            }
          }
        }
      }
    }
    function processDirectUse(source, use) {
      const instance = ensureComponentInstance(source, use, source);
      const policy = targetVisibility(use.target.id);
      if (policy.boundaryVisible) {
        makeVisible(instance);
        addFinalRelationship({ source: source.id, target: instance.id, kind: "direct-render" });
      }
      processUseSupplies(use, instance, source, source);
    }
    for (const rootId of sourceDefinitionIds(definitions, context.uses)) {
      const definition = definitionsById.get(rootId);
      if (!definition || visibleDefinitionIds.has(rootId) || !targetVisibility(rootId).boundaryVisible) continue;
      makeVisible(createInstance(rootId, { id: definition.id, title: definition.name, definition }));
    }
    return {
      instances: [...visibleInstances.values()],
      relationships: [...relationships.values()].toSorted(
        (left, right) => relationshipKey(left).localeCompare(relationshipKey(right))
      )
    };
  }
  function createGraph(definitions, instances, relationships) {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const localNodes = instances.flatMap(({ id, target }) => {
      const definition = target.definition;
      return definition ? [
        {
          type: "default",
          id,
          title: definition.name,
          description: definition.relativePath,
          links: [{ href: sourceHref(definition.relativePath) }]
        }
      ] : [];
    });
    if (localNodes.length === 0) throw new Error("No React component definitions remain after filtering.");
    const externalNodes = instances.filter(({ target }) => !target.definition).map(({ id, target }) => ({
      type: "default",
      id,
      title: target.title,
      description: `${target.externalPackage} boundary`
    }));
    const candidateNodeIds = new Set([...localNodes, ...externalNodes].map(({ id }) => id));
    const edges = relationships.filter(({ source, target }) => candidateNodeIds.has(source) && candidateNodeIds.has(target)).map((relationship) => {
      const label = relationshipLabel(relationship, definitionsById);
      return {
        type: "default",
        id: edgeId(relationship),
        source: relationship.source,
        target: relationship.target,
        kind: relationshipKindLabel(relationship),
        ...label ? { label } : {}
      };
    }).toSorted((left, right) => left.id.localeCompare(right.id));
    const nodes = [...localNodes, ...externalNodes].toSorted((left, right) => left.id.localeCompare(right.id));
    return { groups: [], nodes, edges };
  }
  function focusGraphOnRoots(graph, rootPatterns, instances) {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const roots = graph.nodes.filter(
      ({ id, title }) => rootPatterns.some(
        (pattern) => matchesComponentPattern(targetsByInstanceId.get(id).id, title, [pattern]) || matchesComponentPattern(id, title, [pattern])
      )
    );
    if (roots.length === 0) {
      throw new Error(`No visible component matches the --root pattern: ${rootPatterns.join(", ")}`);
    }
    const reachable = new Set(roots.map(({ id }) => id));
    const targetsBySource = /* @__PURE__ */ new Map();
    for (const { source, target } of graph.edges) {
      targetsBySource.set(source, [...targetsBySource.get(source) ?? [], target]);
    }
    const queue = [...reachable];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const target of targetsBySource.get(current) ?? []) {
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
    return {
      ...graph,
      nodes: graph.nodes.filter(({ id }) => reachable.has(id)),
      edges: graph.edges.filter(({ source, target }) => reachable.has(source) && reachable.has(target))
    };
  }
  function mergeEquivalentContexts(graph, instances, relationships) {
    const targetsByInstanceId = new Map(instances.map(({ id, target }) => [id, target]));
    const relationshipsByEdgeId = new Map(relationships.map((relationship) => [edgeId(relationship), relationship]));
    const edgesBySource = /* @__PURE__ */ new Map();
    for (const edge of graph.edges) {
      const edges2 = edgesBySource.get(edge.source) ?? [];
      edges2.push(edge);
      edgesBySource.set(edge.source, edges2);
    }
    let classes = new Map(graph.nodes.map(({ id }) => [id, targetsByInstanceId.get(id).id]));
    for (; ; ) {
      const representatives = /* @__PURE__ */ new Map();
      const refined = /* @__PURE__ */ new Map();
      for (const node of graph.nodes) {
        const outgoing = (edgesBySource.get(node.id) ?? []).map((edge) => {
          const { id, source: _source, target, ...metadata } = edge;
          const relationship = relationshipsByEdgeId.get(id);
          const suppliers = relationship.kind === "direct-render" ? [] : relationship.supplierIds;
          return JSON.stringify([metadata, suppliers, classes.get(target)]);
        });
        const signature = JSON.stringify([classes.get(node.id), [...new Set(outgoing)].toSorted()]);
        if (!representatives.has(signature)) representatives.set(signature, node.id);
        refined.set(node.id, representatives.get(signature));
      }
      if (graph.nodes.every(({ id }) => refined.get(id) === classes.get(id))) break;
      classes = refined;
    }
    const classesByDefinition = /* @__PURE__ */ new Map();
    for (const node of graph.nodes) {
      const definitionId = targetsByInstanceId.get(node.id).id;
      const contexts = classesByDefinition.get(definitionId) ?? /* @__PURE__ */ new Set();
      contexts.add(classes.get(node.id));
      classesByDefinition.set(definitionId, contexts);
    }
    const outputIds = new Map(
      graph.nodes.map(({ id }) => {
        const definitionId = targetsByInstanceId.get(id).id;
        return [id, classesByDefinition.get(definitionId).size === 1 ? definitionId : classes.get(id)];
      })
    );
    const nodes = graph.nodes.filter(({ id }) => classes.get(id) === id).map((node) => ({ ...node, id: outputIds.get(node.id) })).toSorted((left, right) => left.id.localeCompare(right.id));
    const edges = /* @__PURE__ */ new Map();
    for (const edge of graph.edges) {
      const source = outputIds.get(edge.source);
      const target = outputIds.get(edge.target);
      const id = edgeId({ ...relationshipsByEdgeId.get(edge.id), source, target });
      edges.set(id, { ...edge, id, source, target });
    }
    return {
      ...graph,
      nodes,
      edges: [...edges.values()].toSorted((left, right) => left.id.localeCompare(right.id))
    };
  }
  async function buildComponentGraph2(options) {
    const scopePath = options.scopePath;
    const sourceFilePaths = await collectSourceFiles(scopePath, options.sourcePaths);
    if (sourceFilePaths.length === 0)
      throw new Error("No JS, JSX, TS, or TSX source files matched the selected paths.");
    const compilerOptions = await readCompilerOptions(scopePath, options.tsconfigPath);
    const host = ts.createCompilerHost(compilerOptions);
    host.getCurrentDirectory = () => scopePath;
    const program = ts.createProgram({
      rootNames: sourceFilePaths,
      options: compilerOptions,
      host
    });
    const programErrors = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (programErrors.length > 0) {
      throw new Error(`Cannot initialize TypeScript analysis: ${programErrors.map(formatDiagnostic).join("\n")}`);
    }
    const selectedPaths = new Set(sourceFilePaths);
    const sourceFiles = program.getSourceFiles().filter((sourceFile) => selectedPaths.has(resolve3(sourceFile.fileName))).toSorted((left, right) => left.fileName.localeCompare(right.fileName));
    const syntaxErrors = sourceFiles.flatMap((sourceFile) => program.getSyntacticDiagnostics(sourceFile));
    if (syntaxErrors.length > 0) {
      throw new Error(`Cannot analyze selected source: ${syntaxErrors.map(formatDiagnostic).join("\n")}`);
    }
    const checker = program.getTypeChecker();
    const definitions = collectComponentDefinitions(sourceFiles, scopePath, checker);
    const definitionsBySymbol = /* @__PURE__ */ new Map();
    const definitionsByDeclaration = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      definitionsByDeclaration.set(definition.declaration, definition);
      const symbol = canonicalSymbol(definition.symbol, checker);
      if (symbol) definitionsBySymbol.set(symbol, definition);
    }
    const context = {
      scopePath,
      program,
      host,
      checker,
      definitionsBySymbol,
      definitionsByDeclaration,
      externalTargets: /* @__PURE__ */ new Map(),
      uses: /* @__PURE__ */ new Map(),
      directUseIdsByOwner: /* @__PURE__ */ new Map(),
      analyzedUseIds: /* @__PURE__ */ new Set()
    };
    for (const definition of definitions) analyzeDefinitionUsages(definition, context);
    const rulesByComponentId = /* @__PURE__ */ new Map();
    for (const definition of definitions) {
      const bindings = createPropBindings(definition, checker);
      rulesByComponentId.set(definition.id, analyzeConsumerRules(definition, context, bindings));
    }
    const visibility = createVisibilityByTarget(
      definitions,
      context.externalTargets,
      options.excludeFilePatterns ?? [],
      options.excludeComponentPatterns ?? []
    );
    const collapsed = collapseComponentStructure(definitions, context, rulesByComponentId, visibility);
    const graph = createGraph(definitions, collapsed.instances, collapsed.relationships);
    const focused = options.rootPatterns && options.rootPatterns.length > 0 ? focusGraphOnRoots(graph, [...options.rootPatterns], collapsed.instances) : graph;
    return mergeEquivalentContexts(focused, collapsed.instances, collapsed.relationships);
  }
  return buildComponentGraph2;
}
async function buildComponentGraph(options) {
  if (options.sourcePaths.length === 0) throw new Error("At least one source path is required.");
  const scopePath = await realpath2(options.scopePath);
  if (!(await lstat2(scopePath)).isDirectory()) throw new Error(`Base must be a directory: ${options.scopePath}`);
  return createComponentGraphBuilder(await loadTypeScript(scopePath))({ ...options, scopePath });
}

// src/plugins/artifact-generators/react-component-structure/cli/command.ts
var usage = `Usage: react-component-structure --base <directory> [--tsconfig <path>]
  [--exclude-path <glob> ...] [--exclude-component <glob> ...] [--root <glob> ...] <source-path>...`;
function readValue(args, index, option) {
  const value = args.at(index + 1);
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.
${usage}`);
  return value;
}
function parseArguments(args) {
  let scopePath;
  let tsconfigPath;
  const sourcePaths = [];
  const excludeFilePatterns = [];
  const excludeComponentPatterns = [];
  const rootPatterns = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--base") {
      if (scopePath) throw new Error(`--base may be provided only once.
${usage}`);
      scopePath = readValue(args, index, option);
      index += 1;
    } else if (option === "--tsconfig") {
      if (tsconfigPath) throw new Error(`--tsconfig may be provided only once.
${usage}`);
      tsconfigPath = readValue(args, index, option);
      index += 1;
    } else if (option === "--exclude-path") {
      excludeFilePatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--exclude-component") {
      excludeComponentPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option === "--root") {
      rootPatterns.push(readValue(args, index, option));
      index += 1;
    } else if (option.startsWith("--")) {
      throw new Error(`Unknown argument: ${option}
${usage}`);
    } else {
      sourcePaths.push(option);
    }
  }
  if (!scopePath || sourcePaths.length === 0) throw new Error(usage);
  return {
    scopePath,
    sourcePaths,
    ...tsconfigPath ? { tsconfigPath } : {},
    ...excludeFilePatterns.length > 0 ? { excludeFilePatterns } : {},
    ...excludeComponentPatterns.length > 0 ? { excludeComponentPatterns } : {},
    ...rootPatterns.length > 0 ? { rootPatterns } : {}
  };
}
async function executeReactComponentStructureCommand(args, environment) {
  const options = parseArguments(args);
  const graph = await buildComponentGraph(options);
  const resolvedOutputPath = join3(
    await mkdtemp2(join3(tmpdir2(), "architecture-companion-react-components-")),
    "graph.json"
  );
  await mkdir2(dirname2(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(graph, void 0, 2)}
`);
  environment.writeStdout(`${JSON.stringify({ graphPath: resolvedOutputPath })}
`);
  return resolvedOutputPath;
}

// src/plugins/artifact-generators/react-component-structure/run.ts
async function main() {
  try {
    await executeReactComponentStructureCommand(process.argv.slice(2), {
      writeStdout: (output) => process.stdout.write(output)
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
}
void main();
/*! Bundled license information:

is-number/index.js:
  (*!
   * is-number <https://github.com/jonschlinkert/is-number>
   *
   * Copyright (c) 2014-present, Jon Schlinkert.
   * Released under the MIT License.
   *)

to-regex-range/index.js:
  (*!
   * to-regex-range <https://github.com/micromatch/to-regex-range>
   *
   * Copyright (c) 2015-present, Jon Schlinkert.
   * Released under the MIT License.
   *)

fill-range/index.js:
  (*!
   * fill-range <https://github.com/jonschlinkert/fill-range>
   *
   * Copyright (c) 2014-present, Jon Schlinkert.
   * Licensed under the MIT License.
   *)
*/
