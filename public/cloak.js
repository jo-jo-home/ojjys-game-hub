// Tab disguise: swaps the page title and favicon for something that looks
// like schoolwork. Adds a section to the customize panel on the hub.
//
// The chosen title and favicon are stored resolved in localStorage, so the
// tiny inline script in every page's <head> can apply them before first
// paint without loading this file. That matters: applying later means the
// real title flashes first, which rather defeats the point.
//
// Favicons are inlined as data: URIs rather than loaded from the real sites.
// A request to google.com/favicon.ico would show up in network logs and
// wouldn't work offline.
//
// Worth being clear about the limits: this changes what the tab says. It
// does nothing about network logs, a monitoring extension, or anyone
// actually looking at the screen.

(function () {
  "use strict";

  var KEY = "hub_cloak";

  // The real favicons, fetched once and inlined as base64 so the browser
  // makes no request for them: hitting google.com/favicon.ico would show up
  // in network logs and would not work offline. 32px to stay sharp on a
  // retina tab strip.
  var PRESETS = [
    {
      id: "docs", name: "Google Docs",
      title: "Untitled document - Google Docs",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAACuklEQVRYCc1Xz2sTQRR+M/sju2wjYhWqKwQEL+JBwdqzpXrwZm/eFcSjnvTiwULPglf/AC+tx0KrN0XqISLaQ8XSClGhRBowmyab3fG9yGZDM7szGyLtI5udvJn3zffevHmTAThkYVnzzy60KpyJGcGZBRBlDUv13IPfe7+q1cXTG6lS3ZISuP60cT4yrFXDcisAovdRQTGDwXZtp1Zv7M7XX0yvq8Yn/TxpDL5j4DdM261EnSZEnQCiUONpB0iV+ablLE3d+3h1EC+vnUGA2QIdLyoi6gBnhs/BWjqrSUJKgDGK+2giohCAG34MtlYkpARGmzq1okgA5z4jEvc/T6c9w62xEhC4bskTd9sAjPkiFsuTd6uZJMZKoGTZ4Jac/uOYDDxnwj/uHVu+8GD78rD/AKZMOYqOPJ86cVJqajqe3wmas1ggqgcHjDUCB8GT3yLGlGDyaqYdgRCLoe7WxF0ElpFMn//WIkCAlyocHEtaOIdm2A8FbNRiLcJKAlQQsMrCk3kHJif0CNT/CLj9PIAuGqsslAQIIEagZytt8EoquH/BaLZFz0ZntJIAQdLar3zqQozJpCMcU7vs6EyvuQ0pB+YumoUisP4tGm8OPLxZOtwcWHjVBhf/muhIC88jyhudRdDOgbeb+Tlg4LrbWHpJ6NvSQi6QA7euWFB2s33a2Y3hw1YERKSIKHliJHt14M41G06Vswm8+dKFd1//AwGakrbf45f7GOJs3xqByO3PssyBTE0oCps/sbSmqqEWHjaFw08gWgR6AzUPlyFmCkXBlFGgjdB9NAlg7c9O9xG8JBPB5JjSCKAypvo/NqEEBdaU4UmTMOLiNXRaPwzbO9O7l+Wlvww10ZET6Anerr7zMFxL1IPvTD/nFvfO4eViBiOHAdG4nA6i9tvoN11yBHu/9sjZ6quPUuMv3tPwSY0Vi80AAAAASUVORK5CYII=",
    },
    {
      id: "drive", name: "Google Drive",
      title: "My Drive - Google Drive",
      icon: "data:image/png;base64,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",
    },
    {
      id: "gmail", name: "Gmail",
      title: "Inbox - Gmail",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEfElEQVRYCe1VW0xcVRTd59xz51FQmMqjFbXS1kcCpFYZwFhfPCS2TfTD+KONqWCq+FXjhyb2t74SY2LSxKRWxTRR9MdPyqNFPgoDaaulUZN+tKIoYHFEZubO3HvOce/bXpjhDpih+iU7mfPaaz/u2vucAViX/zsDLJuACzU1gYRlVfJU6kr91FQyW3e965keKC4vgQhcgt/YAbA9f9xbDG3b0pxIJYYlyAk7ZI4OV9+2z9Nd7+wMGPtvKhcxKcSEvksM2YPiAc+ny8DI9qpbHCXGwoxtymgNBmOgEaG0PsK4+XrTxYvznkEhsz5eElGbFt7hBusEjKQkAA8ASItdtsBuLG6FaZcBKY0mCm5hcIURbJwl/oKcdVVVFvXO7b6/rpDAhJ3a1Xjfn31V/dzknRIDO0i6QueOBWCYekuIGQ2EcxMwAEK0yRZiIKUwCSGamC0HZ1oansvWr7aebY2+EDKhTzjiXiejAb8lVzAgUlxCh4IGU1masyCuFluCjl1JY9omiDLB9CezzdHGeIK/dsfoaN6SxPfURWwr/K5g0EFMki159QuWWUm3/G7E03c/Y8fD5SBkxo/FE+daScIGfylyg+6dbm/YsRz4e0s06qRDAyGDdTjIHJUwnwimYM4OQY+1PU16N4HPWt8LfLT3U/i5vA5MKpLbgrnm5C6JXxRgrMmU0D/THN3vIWZbGg5wxk6YjO9MSZXHGqgHQTAJ5+2N8PL8g/BGot5l3x2KnYT+pbIWju7pht2jb0P0hy9AMw6KUbFyxcIkBGNlgrNjMy3RetQGkPJOj/Jc9NWd4aak4cvUNvggUQt/BUJQyhy3BG4CBBOOhlSwBL56+C34qeIeeBwTKbLm8vlzS0LWQc67CJDBpPITTl+t4A8VhPcXauFr63bgTEMA75qHX0yAHHEtsWMVjNQ8C1NlNfrJ4UO6GqY4BfMMCEdCe2qylYRsQjh8Z2/Uhxd2sgt2BIJYAjrPFl/b0xNkOimYrNjBju7tti+V3jloKMd9nLINV1tjiQBp1xNG0Ymu+V32904pJuMPTj58CXiO6UakA8WBFx/qOWhK+3lMLI6Ue+oV52uYK2El9z3x1NZXkkoEiPKVZFWPHO/qBmmz4qHzHyul222tzuBV9NFIzonaDajDKzvqgGoLf3Pm+GaMfrUBVwq/CgOeCTLhlq1scDyWMkRbWuljLsVIsyfePinVkTjI9or+8bOkE1ItgTzwsjmnCZfpfNtbe0/TteiYbqmPmZy/GWQ8QiDs6Vmp4dWKgbFun9E/HKxagpVsKwfGP8Tn6jGk+5wDEMs40FbWHys4OPlfUwJkeHNfbHzeyTw6J6Ct8mTsWzpbixRUguUBqk+diy8/K3S/ZgYKDeTDM+026GICLKurfeD/4ADju/+GbgmUo8ZBJ381gkWbfW9uJrmYZKF5KMW5UZRrzvBhl0n7MtPmCPlzEzh56MYfHzk83wx2uhn/C/DhWnq5bK4nCw3s4VVQTTJLHvT21POcMweHvrGnP1+z3yV/66t1Bv4FBv4Gaim13qNVdsoAAAAASUVORK5CYII=",
    },
    {
      id: "canvas", name: "Canvas",
      title: "Dashboard",
      icon: "data:image/png;base64,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",
    },
    {
      id: "studentvue", name: "StudentVUE",
      title: "StudentVUE",
      icon: "data:image/png;base64,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",
    },
    {
      id: "classroom", name: "Google Classroom",
      title: "Classes",
      icon: "data:image/png;base64,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",
    },
    {
      id: "slides", name: "Google Slides",
      title: "Untitled presentation - Google Slides",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAACaklEQVRYCe1Xv2sUURD+5u0P9jzERgtd8EQI2IqovYi15I8QLLXyT7CzEkHstTKQUhOxFAvtRAhIDBiJRTSYO/e82zfOy10uJJnd9/Y8TOPA43bffjPzzcyb2VvgiIWq/P9azjoJDa5GhKQsq1B7+1EK2t4s3x2/iQ97u/4rlUDxAnNJnLw0KXf8JsaICOivll+2f/D8ydt4G6pnNKBBcsNk3BkWQPDqAcIhb0V4vvUIVzS72p5KAIQUrMHr9/oDIDbIkzichE4A07gfkesPJRO7JJ74M1FFoD5Uz9MJCZZMPMblOvhsCbiyjVch5TCEPAYWth5Wk5gpAUoJJhutSH4HsfTwMcqTE7TQfYqLWiaE4IxEIk9P6fG02siHP3FNeur9QW+6xkHU395bqQyROs7CMsBytJu2pRtx5DfvRzCD2heA7FyzPBSr4O6KkFCH7cSWn4AtQfktmLN3JkohF3btAfjjXRkK9S7qn+564lH57Mo98O+vEpUMXU0ER+lpmLn7UjK15Ie0wgiM1XjjmaT1sxA4ZGe04c5JuwM4AoHSiABMa+eNU3m43GF1mAbyb9qwhlCzDEzaUSLVxJXAYRpIMwJZR8ovDqr62zkXTBMJI2CSHZvRpaVw22Mdn4KfABnw5itYlnmK0CNjwd9fS6b8eD8BIwS+LYI3Fn3B7H/uWtX4zfsRzmyAof3ew+/8OQq3NRXyPwE9A7Zy2k+V5rGS+gbRCRBscMcFUorIdjWo2gXMtGx7vB5nOKMpNdqTEMserQ0xVKeYmhbnoFjKzsfu49TAhHycqqTc3wYGRzZ5Q9eLTyrmqDf/APTaslCKJODxAAAAAElFTkSuQmCC",
    },
    {
      id: "sheets", name: "Google Sheets",
      title: "Untitled spreadsheet - Google Sheets",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAADSUlEQVRYCc1XTUhUQRz/z7y3n1JqZoZbbKVGYBB72KxbRB9E0UFTCAr6oK9LUV0Log/o0sVL4KFL2UEowSAPZUQny0I6GAUmfajh2lZmumo7M8289T12385783YRcmD2zfy/5je/99//mwH4zw05rR9rb4zqOmoAjHxAnKyy5H4NphO/+wdOd7/LkiqHUgAN7U11RIMnWlCPMiZiGD+uwbCGITE4NjKRnGxM3nj9ytU4S4mzxtaQYNilhXxRMpMGOis6UXaS4nYAEd2vP1x5ZetmK5hiIAUAmPpZZusKd5uaUEAIRRAGzyDkABhSc25b25wyDoLnjWcQcgBmtCKfLJ0BwQQTV+NxtzALC4DzJl6d6PQvAZ7hEca0zorLziAWFIAe0CEQ8oN/vvv8fB4OREqWhjtrW3fEZEzoMmExMrHrsqoyqSsO+yIkNbedK/vtBgvKgD24NacMeFpLy5knBtKMAKFSf2sN+0DDGuhIs4vz5koAlFFYu2QVVJdU5jm7CUanxuHz5Aj/R7qTrAQwS+agsWYnHNqw3229PN29911w800bhPRgni5boAQgjKkosry1vr0L46mffFfI2NnJ+hZD3jbQAYIpyhOxMlQOZzcdtnwMA5cfTwBM/66hHhic+Ao6xqDx99tcu9tQ3f/wCAjPkzSlUFu62gBg+qieBQHYu2YbJFI/LAbKA6VG/Ja6PRYDK0LLVGvm6D0B4Mwa7XzsSI6zObm25Zw5tJ6mjyVwGHgCwF+50a733Yax6aTFwMXYMUN+q/+OxUBVuAIuxc/wr6LDijaxJwCmz/Phl/CR54Bm5IAOJ+qbDdXjTy94DqR5raBQw3NAAPDaCgJwcP0+SM78shhYHiw31jm1scVioCIoL8dOgLwBYBk+j9cfkMa5EDuaL5/3yVfkSpQAApofOga74dlIb66nYvad1wvhq2pKAKKUjk4lYPjPN1WsHD3mdUJTlGHhoAQgjEQgL8GEbaHN/UtRaLQi7BcpAOYxhQvZMZLHlDKAEKYIeyxlHkEghqdkptIk5GfaHn7TGcVBvTpzKyv6miAuKkBm018QgacyAI7bjLc3rWM6NHAmsPw0Jwtnk/ETGWeen8xpb1/TgyGbdnFM/wGq9xXZ7cRoigAAAABJRU5ErkJggg==",
    },
    {
      id: "schoology", name: "Schoology",
      title: "Home | Schoology",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAFFUlEQVRYCe1XW0xcRRj+ZvZCWwT3ItBCaaOYaB+IqSUkPNjqQ7sChbaKtDGaiLFtYsQmJoYYE0PUaFOD8f5gbUyavtTYKDTcNFVEMFWTqmkNxivW9AYCu1BQ2J0zfuccTvdSKOyKb06yZ+aff+b/vpn5/39mBRJL9/itUOoou0r404AwWLWgyv8susM3Quk2CLEOWquEaYIjNYQegpB91HG+8QmqguMJY+ZtupM0hlpJU6sIchRCnQVcD0CLW6wxsWgQcK+GNt6jfJrkXAQlSRZhtl0FbJWS8NskchadowcxMXkY9cV/WWPm+SQT0ELS6BQk3sTdwVPoGLuN8uwYD4H0DATeQmWgb057rcM5cLvXk8QeDn4R2dmb8OFIE7YH/5hzPDuTCTijJCnYRThds7W9YlNoH7mXq64jmHkcFwn4NZQ8gercXsq96BwJAfI1eMT7PL5dCPl+M6elFgcouV+JVOBkvSkJWcvjqGZrNYEq2fE63KoHneG96NBZqAx2U7eLx5MDZbyKjpFcc1pqmZtA6qi5ZAEXpDhGB70TyK2AW+yg/3xJJ2wBwofQO5FH3Td0yN0kVwEp981lJnMCpjWNNej6sxxGxIUtuf2o9BEMj/K3FZOxFnyql6Eq0M9dOAgDD+P46BpzWmLJgMAVt/mJhjbAkB3ci8+srTctV/kPw1D7SK4OU2MPmV12ZLDHhVpbjn/TJyBitn9M6FfgcVcwb9QxMk7SHw4w9B63TE8Fj3DbP+DKG3H8/A2o9A/CYG6ACPGIkjCThDivRbTqAxFszhlATV4PQtfv5YwDdMwn0T5ainqhGEfvcs2FcOdstKxJJimIErQN5SVaz5xAohUhNLzed7i6CTrmZktlqB9IYgyIls0OHeRRZMGzggktXpaGgGnvl+xRrvACj6Nw1vw4d2AShsi35Jicol4hGsua1VvV0hEovuzjCvMJes6yrDxetr0EnbZkl/JQz+DV0f+GAKINBMtB1PjIXprknQI/QX+0ZCEKrFSuFHcqXq7EVLxrka2uSAAxVQjpuo4RcB9nNXDFzagNfm9biJq+4IVLfG7LxnpoeQ5Fvw/bsv1Nn4B59ZrF0LvhzWpEdMbDlV5k7xNY4Tti6boiN5NUI52yHeO+76w0bMgtJNOKsrKkI0ifgCCcWaIzxxh2A9DRMWjvGWz10eNZWi8VMBG9wePwkNR+KyS7R2ugUASoVmtMwid9As7kbfk/s2n+7NLMa7s8wpg3nid4CcH3oDpwGl3Dq6BEE5NSK0KBAWe4U2dO4OPLpXwhrYOK0oYsghjfyG3fRPABxv9OpuQedOtsqPB+7plBZ3yJJFgnl/QJOD6gYk/TD+4hIGNf/00QOp94DNNoww5/2DoKHXmZwHcQ8n4+YgaToW0pfQKOFQ0fgU/wrn+ERMaxLW/CUn2hl/MltZ1H8BR1ubysGlDj63Ompdb/goBBZxRZJLESLrkWnWN8T4oNiETuYv9NkLqTL6TnCP5rKmiinDkBIc4zzHZCutsJSJt8LwKXeOt9xWu3CSf9/Wi++swTwc12+gScMJTGMzA8h4AYzahpxIwwlrmHsJm3ZBolfQKO8ZD10p33tesMW6heustoIaR59P8TWPwOOAlonq3MtHthAkb8z1CmINealxwFZkTxb6YV1uYswRgT7tv55H6B2a6Ysb6cWf2qfH4tgIV0yQRkjHldfktg+2o1xClmunICP2iREuIMb7YLCxlNR/8Pz+msPBkZ4xQAAAAASUVORK5CYII=",
    },
    {
      id: "powerschool", name: "PowerSchool",
      title: "PowerSchool SIS",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAFMElEQVRYCe1XfYhUVRT/nXvf7M66M7uzK+uaZYWC0BcWSJZ9sRL0AZUEu1oJFX6guysEarHQH4ZBWBHK7uy6QhRCoBgKgiJZZlr0pUWWYZLYZki65n7NrDPz3r2n897suDPbmsy0QX90Buaec+555/zuO/eecx8hn1b03aiU8zlC4amwVmYYsKbVxivjWDVUpyy+h1NeDyv6HJECvEt9zPQdKf7AOmoPNkWO5aavNjr5Bg6cGRI2Bnf4PdH3gXQT2M4MbKyeIZEi8NI7RHcOJD+fJKr8VwiOKhmXKI/bqCV5mNi+6XVGP/ZN/o4KAIDEDfEf1tGrZRXnqHlgJkHpwIGS12HgWW3a0B47Na7TJQO1CNOtimkZa2efahl8x3JqDTqnJMa1F2UhgKwVwXPDAUvKDzuGdHmgWDF4j3LKF8CkDTT9ao36El2VR2XukLzFQ1g5sE0ptU2ripnmOW7Eu9Q/xlEgSgKLpEzWXqAtlSS0sOIG2S9rlbIf6dbEId2afDyw6KreYw3uZsbNNGloK9bxeItF8QBG8Tpk0x9yvHquLbN3WJj5shGPMdT7qmWoG6u4HJujP1jmhaRDDap3aO3oo6Nc6QCIZBNSFHJysLGmH/HYN3JaWsnNLJBt06RMoj0I01n1KUzmdeFX44XkNaOhs1zpACyfZRWap7RzRF7712gefMx3abqr9yqbaZL0PK9bhxf6Oqsyb8vRJeWaxb6cT8UDKMs+bh33VfE5m8DLwHxekdqJ5sQz/qwXj+0X3Va23nosPxJCR91ZKLUdTIvyg/t88QByHtonD6Kj/ISJV+0y5yv9jdehYDqx/OL1voklektO0HQ4s+b6MjEOSGGbJiCn+nKOSgeQ8+CPO8jYlFkvdWRYOU5TMOVGTsvyflGE+33ZaO+UpCUq7L8AwI8wWDVAzD2yyut8EVtwSVbdK2+hNpAzTlrSQo7lrBwo/0kKRhxcHmoQYdANYHUh0C0/6p/7sABIB/LI3oGjs/LIgxOTAnGmnMQiecW1VmFX1vesaimi10opPx7IHuokRUmP6beR2MEwbnXKN7gi38gaNX0RhJx6RfS0bLM2GLMOXbEgoNb6XpbmZch85ftQsA/KKeiHDv+e77NkAKousRSqYgPYk4KkE1KOX7RdsU2B82aOMA1tkG66Gx2Rn0VHrNAghl+gnQpSUDIAi8xeaZP90pUveE76aFAN/eiNx8uUSnbDotxCvxwAaknMJ9hbpDe8FMh5fyUDQOfkMwbYnucLoebE7Rb2NdnsczTph2y8ogdruFINJ96Q1R/G5qrP8u19vnQArclp2tJdQCbEypkqR+5hQ9Qg3e8Ee/YB2x390Q+g0qmNsvmmG7bZ+uAr86h4ALl2bL02diqWwXh9UueZtT4oN7Vn4Z7ciS1zXDSeqdD1te0CaLEltwnxGn8v/IWKB3DZhaohL3XATIk+ieNw/WoYTEnfd1ZevI8p9Iocw9nWSz2FzTW7Lz82hikdQHAnlGtJb6oedclJTnNiuiW+k3qHnrA6fBuzOcjGzJPgP42JWSAWDyBX0UA90o4blUmfAJWlLNgvtZcYvM8qswYd0U8KIl1BKB7AiCPrZjbA4f1yK1ZQdBFI9SJ9+lyQ/ysEG09dMgBsqR0Qh1e9do8XNF83Yb0g32kx/P8A/uNvgK2UcHazOZUbzb9AhafAypVCSeM0MmZJOHpUPjRC8glWL2BC0tizFW+CwBQA8Mi9oFmfRDgWfMfJt+q3cCofgXVvEiBy3071CMDeCYoduPkTFJvxFI8OjYoAAAAASUVORK5CYII=",
    },
    {
      id: "clever", name: "Clever",
      title: "Clever | Portal",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEPElEQVRIDbWWW2yUVRDHf3vpbrtdurHdlqasCLZUKwZpvSSgCTQxYtCExMTEy4OxadToAxLSdwxq6IP6qGJC9EGeWEOBWBIlitZoLKRgUVYtqVBoTXpl3bbb3W9b5/Tbfuf7tnshUSab7Jw5M/Ofc+ZyPle4c4nbSe7b6Vz59t46wOISmUWWlg/sduNxI9GVPH5pAHGaNHBBdZDaNZSXYSxxc47xOIkUPg/+oj6KbUqwcynWhnh+K0+10rKOmiA+rzpHIsmNGX6IcWqAn4cwFhVwXnLlTbLEmzLweuls541d3FmT11YJjQxnf+XQCfr+oNKHSyydlAdAdObSRGr48GXa73eqF1gl0xw6zvu9+Ny5GJ5A24EcqwWD9bUce5NHmnJ2Ci69HnZuJlRO7yBewbAp5uZA7rcqwGevsTli01pmY9c5f1Xl1u+juY6HG5WmnV7fxcg0H3zJGr8WOwAEedbg3T081Kg1hPvtOgejfHOZqVkVndSrpHRDWGXo1ccp92nlg8/SP0T/FVULJq38L6+kHB/cwEs7tIFwpwfo+ITpBAGfugSTpPxHJuk6yo9/8nEnocqs/Mwgc0nctjvSACJMZejYQYXtgBev0nFY2QRtQnEmymUeQhVE+9XW4VcYGKb7JKcvID0ozWE1oAaQ26+r4okt2VjkTyRvHVM9JbEXIjlT9BwTCX4aIj6vNAXb8i5WehZJ+M0NRKq1q4vDnI1RUaCDTD0pfI+Lry9hGMt9oK2znAaQ1DXVqQNa9P3vJOZz69ratRgJWYJY3WKmQtafKBkQXsmVuSdpLGRmeS/J2ALOpyvA/5GyAJIWSff4rMNbQw0Ze74cm7e60CeQ4h2eyI570/qxTQT8jpIo5FWmi/lOrFbQAFK8Q6OMTmmd1rt59B7mU1qSl5PnYdsmMi5k5K0mDSAv1OgMXw1qHWmlA89Q6Sed0cIc7p8ku7dysotT+9nZwuyCUrZnzjFN5cLH4rywHZmOJq2rVrXb+wtzC8tj0mYqbai8P8BHnQQrWB/mue3c28ClESYTutwdAGVurk0SuYO2jTrQlgjt93FtnBvTxJPIdS+k1Y2HQ+x7ku4X9SCSmpZX73i/ciJD26TcB0eN6wpOdLHlLo0hnHi8MMz5v5iI4/PRWMu2ZupCDh1ZvB3lnR7H4MoFECWJcWM90b001efaF18fOcO+z5FrsLfnyklspuVeroyx5z36LtukRdm0QXcP+4/idTm8i5EjB5YTKdmpBF/0qxqVvAVXngFLwc70xdj7KUe+U1PaPspMnTxXZBnL+JPPFnm5drfydBvN9erTSJ4qkcsQHLupPlh6zvFtDDlBoCx/SxYDMJHkm0c6SHoiXMXaKuQCZX7MzPP3jIKR7pEPL/ulW/GZjH5wcjaspRSc+ZzNJJiMZ8OUuWLKS86q0gAWkgQrPzuV9C7KTgu79f/E/wtpP0an9z9JfQAAAABJRU5ErkJggg==",
    },
    {
      id: "khan", name: "Khan Academy",
      title: "Khan Academy",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAECklEQVRYCcVXW0gUURj+zu7mGrulaxe1HjLLjG5Wkl2whx7KrTQtujwEQQ8FJWhUYBQURQUWRQoVPQWRPVSQZpQSpQ+mpghZFGZ3KjEzL6nlbur0n8mZndEzs7sZ9MPu/PNfvv+bcz8MfyNlZTZ01++GJGXL6YzlwZlwAStW9AULx4JNQNG5lZRzDpBm6XPZC3rfg/Q99/V287fACdy5EIsB7xn66gxTSMYKYQnZh9Tdb03jBp3+CZReccDTdpDi91FxeyCgYMxDcWdgjziJlG09ZjnmBIrzt0Lqz4WEyWYghj6Gz2DWHKRlFRjFiAncyUtEv5RP/bzMKDE4O6uElWUhNbtuaJ6eQOnFifB4TlJTb6dAy9DgEb4PUNdcht1+ECm7WhQsHwF5dEs3yBGmOI2e4TY7Ts1ORmpkrBxS3PwWOS8q0NHHu96vdAJskzJbbGo4wyXqa7/FrWAoWZqBpPAoNXXHlDmYN3Y8kiuuo59A/EgYQVyiGJm9r5klaaqfRNntnjhFV1zJWeyKAvcFJJpaPgIBZQIzx0QYRpr5jJKCJtDQ1WaEBTOfUVLQBEpaPqCmo3kYHrdxX7DiG4SazMJFafKgetXTgaLmN7jZ9Aot3p9yBB9k7qpC4SzQDsAJIaOxcVIc0qNiMcPhwtPvrcioLdZU+aMKCYy22jDVESb/VtHAOjVrOXJf1+L06zr0DvTL021n/QNC4D+9hFqs2D8tEQfiFsFhG6U6G3vaVV2rCAm0Dn6tEsiBjs1cJs/7tMdFamsofuXJv/p20josiYhWTOrzm7dX1bWKcAw87/qmjVH1JJpqj5K3wDVq+J7EF6eK5M3C4hzACFNI4GHrR7XoUGW6MxzXFq6mtUQvVxPdmOF06Y2aNyNMIYHq9mZUtjVp0vWqOzIGm2iAKbIhejrWRhqvYxyLY4pESIAHHm+sEcWrtqPxS9VWOEa6mZwwwTIkcK/lPcpMuoKvegvCJiCB9oDZY8cZ1i8njLuEZSSGBHjC+ppiPOlUd85hGLzZ15g0fX3nV2QQhpmYEujs88JdXYiX3eLlN94ZgXhaZETS2N2OlOpb4Bhm4iPA2DtR4BfPDywoL8Dhhkr09P3ShUTbHYgOdehsPyjmSEMV5pdfBc8ViqaWbzYFcCCZTMUyYxLAZ8HcMePhoVWRi51Wv2ddrSilveD8u3p86u0W1h006g4kPgLcG8SRjCeOCwmVMfkq5/cYAvg5kslQg3//7VCqJSFJDLfztpIpl07Hk7SuwHXGV7McrMsuoAOpsJH0XSBC5hcTb/shOinvDepiwthZhLhOjOxioiUkX808Z6mz07XmYTpDESz2vf/uaja0wn+7nGqJyNfzp5mQBrJkM7Pkwznv/N9cz38D+WVdKmLltZ4AAAAASUVORK5CYII=",
    },
    {
      id: "desmos", name: "Desmos",
      title: "Desmos | Graphing Calculator",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAE2klEQVRYCb1XS2wbVRQ9b8Yz/o8/cb6QkC8hVWkClYgoQggRCdQFCKGwKhsgG6SCVCEIZQ8sYAd7UAVCLBCiKz4rPqoqdUEKTaqmkdpSAqRqmsSxHc/vce9znNpJ7Do0yVNiz7z35p5zz/08jwCNkROz41LoJwVdSunz1J4NITRIyGkpxOT5D3tPi0MnZp/VhH4KEJaU3p4BVxoWQqdbuSJ9e0LTID7YT3AmohwVwoJmnNSk0Ib2y/NKFaTPaothCsjux9wjk1JWwtW4JmytxtL/mmZMQZnc02IgGtTgN0BiVwl4nsQLoxY+e/0eHD+absiJXSPAzgZ0gQc6TaSiOoa7g0iESYU7RHjXCJTdLQOqPChP1vneMQGXZPbWg8vxpj9177iyoZhv5hLYPFHrnrPaIfD+NhNjh6I42BVCjCRmQuevrOHsbAG/Xy3umERDBNhhg+I7MZbEi48l0JKofuzIYASvPCXxw9QqNI01aWywU9WW6jw3+XwG40cstYMJzf1jYznvIWRoGGg3ETQEjh6OK0XqmKlaysS8OxNYcySOPZ7YAL+x7OKj04v49WIOK3kfIVPgYGcQrz3ThMN9IVUJVSjb3HBhtMdd9Gfs+o3Io27ZkQrgpSeSysxSzse7Xyzgm7MrWMqVDq6CLfHzxTze+fxf/HGtuA1c9RTL3hoj8KYSeN0q8OngfLg3hPuos/H48pclBcZe6xRrrgIOecTUcP2mg/e/vgG3TvvjpUTYL4ETMt3WV4DZ9baajI1swcdPM/maPZ6T9NK8jYt/1VbBpFO4lzw36Lt8VtRVgKu8KcZnN5C3PQSFjXTEU16XDajF9Q+fJudvupVTG9fsfVfKhhX0q0q1ZhXwA1bYQ9goxTpEWd6XcRFEEQXXxZVFA0sFXYWhjKJRTKzIVp/YVibqqcTbTHzrbrLGm9ooSw+0FrGczSn7sZCOjqYQsZewQj6GWkkNMsrGeXDrbUnoqkGVZkqfnPFhU6I77ZSUq1yk6y0EFLjlYiDjUKwkLv+dx3LOUUn35EgGiaihOqKhSdzfbCMVdkv3pOWrY2nEQrdNMjdKDXQnHcRMTumt4/ZuWmPwJGVpH5eIkPQvsLBYxJmZJfVkT1sELz/diY40K8HGfQw2O+hKC7xNjeq5R+IbCGWwzqSNFlKzrNTGhvWLjRzgDXFKkIHmomJdNsCt9ftzC2hPmRjuS2CoK443xyOYmltRysTCOgbujaE1GayyrZNr3SkHluluZHzVhkoC7LlJcnOJRIzqU41rfc3xcOrH67Dp4HmISESCOh49kNpib24+p2Tu74giFpTosBzki+wKGakxAgweoHhyW0yR/NtJxaHI2z4+/e5PnOtZxuhgAplEEGEiYhO5W6supq9lcebColLJCgdw4WqWwDkFa4MzJzH61iXZ2+SoMtkOfDNxPpK5+8UjAZgBPo595NY8FB2fzgGNkpXKN2LQOeGoX0OsYL0ReLC9SCdatez1HuCOx6KuFqjhrKtLTVmR4edY0VtZm/pDqVXXs8VrgVCAXpTY0A4GO8UAtdTdyW8CejGqqsQd0Lj7rfyeyC8mU5pW6vd3b7JxC4Iw6UV4RpO+/54v/SxP7NdQWFKuUDZNap+8MfKVkP4xStlpQa+qez0UhvR/k5478fHx4W//A5fW0+Xt+NdGAAAAAElFTkSuQmCC",
    },
    {
      id: "quizlet", name: "Quizlet",
      title: "Quizlet",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAEz0lEQVRYCcVXWWhcVRj+7mSardW6N2ZtYlqt0rqDokg0iq0UqUsSl2AVNWIpiFj1QV99UHzxpeqD4F5Maaso3aAaQfBB6IMKRW2SZu0WqzRpTZrMXL/vnjnmzJ0z48QU/JmZe+b8+3/+5dwADrS0hVUlwCMh8Ay3l/EbOOj5LCkSv1HYuyng056twREr7B8FrR3hWqTxVlCCpnSaaLGcTaCmRIJiU+hDAs/t+yz4SuIjA25vD+9JBNjGP+WR8rOpOCYrMgKYTId44JvuYGfQ+nC4BDP4nlY1hvJ8DmDDN9dgBYwEo92PJG5OYhqdQRKNaR5OMTAzA8xkaOlFBIxeBEkmUDJp1oV+5WiihA5Td5KedxUT9mkqFl19LbCiGVh5OXDB+TxTGnH8d+DAQfMdHDZnveBfDJEsRqIrSQHK9oLw1yRLoonlsQ645UZg0UI/+cQp4LsfgE+2A70DQEWZny7apeH8LAvuaJMPfhBm6gywbjWwYT2wsNJPF9+VIW9/CHy+CygrL1zLBQMl5evbga5H4yoK/1eEXnwWWHwO8MFWllaBSHgNUE6dZtjX3uVXfnIc+PEAMDBiDGmoAVatAM6lQhe6OoFjzI9dX+c3wmuAsrzmUob9MVecWW/fyTPeQcFjwJlps1e6ALjkIqDzfuC+Ndk8krH/J+DEH0AJqyQOqsgskPcSrHM/b3EWCpvfB97YDIydAKR0EXNCX621J5xoXFCldNxrZGaq1UWzCGOQYnlcSKY7b81G7PkW+JjZXVnBWvd4or0KJpxoROvCbTcZZ1KedM8xQPW+tN6E1AqZmmLYt5kmE/jcyBAKp0akMrTHI1TVxcBlS4HpzJFlyKNHjgEqvdoqlo6jSDU9csTvuStMa0Vi5DBwsH8WI1mS6Sv4HAPEVr1kllmro8fZDxgF16hsitl/ohGteFyIy7Q4rwHxUBWj2AqMnk707H5cpt33GjB6zKLNs77adDRfCLMpTZjL2HhqWcYuxGVaXI4BmtfDPMOUMx0b6swAchPLCog/RXNFM9DUMIuRLOWQZMchZ0tTrPcQMDg6S6oG8kSHaSQq03wgnGiffCi76QxRlmT6JmSOATrvidPA3p5sNdevAp5/2oRYM0LHwY/5cqE93Q9Ec93KbN49lHWKMn255G3F5aXAF3uBu1vYExh+C+qOddUcMN2c/b2sdWa7oJT01ywHHmeUbqChLsj77i9Nf3D37TrvOJZH8uT1V0yHswzRk55qEI3yXAXVrPH6Gr+Hf55kZ+wxzWmcY9reniJG/uQ1QASaiKtbgJc3cJqVa+e/gZLwqU3mkhLPg5wccFVUUunuHuCl14C+ARczt7XNGR+XDGBA84OM2P8zsPFVvlV8BBwaIoOnEpSUg8PAO6R5bwug0FvQtPQlIPFh0Noe/kLe5YXNMBdS1biuZc2NZljV8ewl+DDb7hB7Rz+jND5hPFIjuvpK4NqrmEOcoBrTY7oT2JiTj59fg9YHwxd4LX+z2Gu5PNXEjKJACQLdcFX/Ol/rqS41usILFGJVlsVpj9dyhDPYNK8XEwkqBmSnjLDgvpgk9m0JjqYDbCRy0tcqLdN8nq7yjI5J6ZTu6ET0jkYFbQxrn0Jj3hjno9LDyzBEYacO6crozFb1f7ye/w07XJFdikzW+QAAAABJRU5ErkJggg==",
    },
    {
      id: "google", name: "Google",
      title: "Google",
      icon: "data:image/png;base64,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",
    },
    { id: "newtab", name: "New Tab", title: "New Tab", icon: "" },
  ];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  function write(value) {
    try {
      if (value) localStorage.setItem(KEY, JSON.stringify(value));
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked */ }
  }

  function apply() {
    var c = read();
    if (!c || !c.title) return;
    if (document.title !== c.title) document.title = c.title;
    var link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    var href = c.icon || "data:,";
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }

  var api = {
    presets: PRESETS,
    current: read,
    apply: apply,

    set: function (id) {
      if (!id) write(null);
      else {
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === id) {
            write({ id: id, title: PRESETS[i].title, icon: PRESETS[i].icon });
            break;
          }
        }
      }
      if (!read()) location.reload(); // restores the real title and icon
      else apply();
      if (window.renderCZ) window.renderCZ();
    },

    // Rendered into the customize panel, reusing its existing classes.
    section: function () {
      var c = read();
      var active = c ? c.id : "";
      var h = '<div class="cz-sec"><div class="cz-lbl">tab disguise</div><div class="cz-row">';
      h += '<button class="cz-opt' + (active ? "" : " on") +
        '" onclick="window.__hubCloak.set(\'\')">off</button>';
      for (var i = 0; i < PRESETS.length; i++) {
        var p = PRESETS[i];
        var swatch = p.icon
          ? '<img src="' + p.icon + '" width="14" height="14" alt="" ' +
            'style="margin-right:7px;vertical-align:-2px">'
          : '<span class="cz-sw"><span class="cz-dot" style="background:var(--dim)"></span></span>';
        h += '<button class="cz-opt' + (active === p.id ? " on" : "") +
          '" onclick="window.__hubCloak.set(\'' + p.id + '\')">' +
          swatch + p.name + "</button>";
      }
      h += "</div><div class=\"cz-lbl\" style=\"margin-top:.7rem;font-size:.72rem\">" +
        "changes the tab title and icon everywhere, games included. doesn't hide " +
        "anything from network logs or someone looking at your screen.</div></div>";
      return h;
    },

    // The <head> for an about:blank wrapper. A tab's title comes from the
    // wrapper document, not from the page inside the iframe, so anything
    // writing one of these must use this — otherwise the disguise is lost the
    // moment a game is opened.
    head: function () {
      var c = read();
      var title = c && c.title ? c.title : "ojjy's game hub";
      var icon = c && c.icon ? c.icon : "";
      return "<title>" + title.replace(/</g, "&lt;") + "</title>" +
        (icon ? '<link rel="icon" href="' + icon.replace(/"/g, "&quot;") + '">' : "") +
        "<style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none;overflow:hidden}</style>";
    },

    // Opens url in an about:blank tab wrapped in a full-page iframe, carrying
    // the disguise. guard adds the beforeunload handler the game tiles use so
    // the tab can't be closed by an accidental keystroke.
    openIframe: function (url, guard) {
      // Opened synchronously so it still counts as the click the user made;
      // anything async here and the popup blocker takes it.
      var w = window.open("about:blank", "_blank");
      if (!w) { window.location.href = url; return false; }

      // Work out what to attribute playtime to, once, in the opener where
      // localStorage is reachable. The heartbeat below runs inside the new tab
      // and reports how long this game stays open.
      var origin = window.location.origin;
      var rel = url.indexOf(origin) === 0 ? url.slice(origin.length) : url;
      var gameId = (rel.split("?")[0].split("/").filter(Boolean)[0]) || "";
      var tokMatch = url.match(/token=([a-f0-9]{64})/);
      var tok = tokMatch ? tokMatch[1] : "";
      var dev = "";
      try {
        var stored = localStorage.getItem("hub_device") || "";
        if (/^[A-Za-z0-9-]{8,64}$/.test(stored)) dev = stored;
      } catch (e) { /* blocked storage: beat without a device */ }
      var canBeat = guard && /^[A-Za-z0-9_-]+$/.test(gameId);

      // The disguise goes up immediately, so the tab never shows about:blank
      // while the session is being checked.
      try {
        w.document.write("<!DOCTYPE html><html><head>" + api.head() + "</head><body></body></html>");
        w.document.close();
      } catch (e) { /* the tab was closed already */ }

      function fill() {
        try {
          var body = '<iframe src="' + url.replace(/"/g, "&quot;") + '" allowfullscreen></iframe>' +
            (guard
              ? '<script>window.addEventListener("beforeunload",function(e){e.preventDefault()});<\/script>'
              : "") +
            (canBeat ? beatScript(origin, gameId, tok, dev) : "");
          w.document.open();
          w.document.write("<!DOCTYPE html><html><head>" + api.head() + "</head><body>" +
            body + "</body></html>");
          w.document.close();
        } catch (e) { /* the tab was closed already */ }
      }

      // A hub page can come from the service worker's cache, and it carries
      // whatever session token it held when it was cached. If that session has
      // since expired the game request redirects to /login, and the iframe
      // renders the login screen inside a brand new tab — where it is useless.
      // Ask first: if the session is gone, close the tab and send this one to
      // the login page instead. /api/ is never cached, so the answer is real.
      try {
        // Same reason as offline.js: without the token this answers "no" for
        // a live session whose cookie was dropped, and the branch below then
        // closes the game and throws the player back to the login page.
        fetch(sessionUrl(), { credentials: "same-origin", cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) { fill(); return; }
            try { w.close(); } catch (e) { /* already gone */ }
            window.location.href = "/login";
          })
          .catch(fill);   // offline: the worker serves the game from cache
      } catch (e) { fill(); }
      return true;
    },

    openBlank: function (token) {
      return api.openIframe(window.location.origin + "/hub?token=" + token, false);
    },
  };

  function sessionUrl() {
    if (window.__hubSessionUrl) return window.__hubSessionUrl();
    var t = "";
    try { t = document.body.getAttribute("data-token") || ""; } catch (e) { /* none */ }
    return /^[a-f0-9]{64}$/.test(t) ? "/api/session?token=" + t : "/api/session";
  }

  // The script that runs inside the game tab. It reports playtime to the hub
  // every 15s while the tab is actually visible, so a game left open in a
  // background tab is not counted as time played. It sends nothing about the
  // game itself — only that this session had this game open.
  function beatScript(origin, game, token, device) {
    var cfg = JSON.stringify({ o: origin, g: game, t: token, d: device });
    return '<script>(function(){var c=' + cfg + ';' +
      'function beat(){if(document.hidden)return;' +
      'try{fetch(c.o+"/api/playing"+(c.t?("?token="+c.t):""),{method:"POST",' +
      'headers:{"Content-Type":"application/json","X-Device":c.d},' +
      'body:JSON.stringify({id:c.g}),keepalive:true,credentials:"same-origin"})' +
      '.catch(function(){})}catch(e){}}' +
      'beat();setInterval(beat,15000);' +
      'document.addEventListener("visibilitychange",function(){if(!document.hidden)beat()});' +
      '})();<\/script>';
  }

  window.__hubCloak = api;
  apply();
})();
