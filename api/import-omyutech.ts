type ImportedPlayer = {
  number: string;
  lastName: string;
  firstName: string;
};

const ALLOWED_HOST = "baseball.omyutech.com";

const cleanText = (value: string) =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeNumber = (value: string) => value.match(/\d{1,3}/)?.[0] ?? "";

const splitPlayerName = (rawName: string) => {
  const name = cleanText(rawName)
    .replace(/^(投手|捕手|内野手|外野手)\s*/, "")
    .replace(/\s*(右|左)(投|打).*$/, "")
    .trim();

  const parts = name.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return { lastName: parts[0], firstName: parts.slice(1).join("") };
  }
  return { lastName: name, firstName: "" };
};

const sendJson = (res: any, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; EasyAnnounce/1.0)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`一球速報.comへのアクセスに失敗しました（${response.status}）`);
  }
  return response.text();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { success: false, message: "POSTで送信してください" });
  }

  try {
    // トップレベルで読み込まず、失敗時にもJSONエラーを返せるようにする
    const cheerio = await import("cheerio");

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const inputUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!inputUrl) {
      return sendJson(res, 400, { success: false, message: "URLが入力されていません" });
    }

    const parsedUrl = new URL(inputUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== ALLOWED_HOST) {
      return sendJson(res, 400, {
        success: false,
        message: "一球速報.comのチームメンバーURLを入力してください",
      });
    }

    const parsePage = (html: string) => {
      const $ = cheerio.load(html);

      const candidates = [
        $("h1").first().text(),
        $("h2").first().text(),
        $(".team-name").first().text(),
        $(".teamName").first().text(),
        $("title").text().split("-")[0],
      ];

      let teamName = "";
      for (const candidate of candidates) {
        const value = cleanText(candidate)
          .replace(/\s*\([^)]*\)\s*$/, "")
          .replace(/\s*-\s*チーム.*$/, "")
          .trim();
        if (value && !/一球速報|メンバー/.test(value)) {
          teamName = value;
          break;
        }
      }

      const players: ImportedPlayer[] = [];

      $("table").each((_: unknown, table: any) => {
        const rows = $(table).find("tr").toArray();
        if (rows.length < 2) return;

        let numberIndex = -1;
        let nameIndex = -1;
        $(rows[0]).find("th,td").each((index: number, cell: any) => {
          const header = cleanText($(cell).text());
          if (/背番号|番号|No\.?/i.test(header)) numberIndex = index;
          if (/氏名|選手名|名前/.test(header)) nameIndex = index;
        });

        rows.slice(1).forEach((row: any) => {
          const cells = $(row).find("th,td").toArray();
          if (cells.length < 2) return;

          const values = cells.map((cell: any) => cleanText($(cell).text()));
          let numberText = numberIndex >= 0 ? values[numberIndex] ?? "" : "";
          let nameText = nameIndex >= 0 ? values[nameIndex] ?? "" : "";

          numberText ||= values.find((v: string) => /^\d{1,3}$/.test(v)) ?? "";
          nameText ||= values.find(
            (v: string) =>
              /[一-龯々ヶぁ-んァ-ヶ]/.test(v) &&
              !/投手|捕手|内野手|外野手|学年|出身|右投|左投/.test(v)
          ) ?? "";

          const number = normalizeNumber(numberText);
          const { lastName, firstName } = splitPlayerName(nameText);
          if (lastName) players.push({ number, lastName, firstName });
        });
      });

      const seen = new Set<string>();
      const uniquePlayers = players.filter((player) => {
        const key = `${player.number}|${player.lastName}|${player.firstName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const memberUrls: string[] = [];
      $("a[href]").each((_: unknown, element: any) => {
        const text = cleanText($(element).text());
        const href = $(element).attr("href") || "";
        if (!href || (!text.includes("出場メンバー") && !/member/i.test(href))) return;
        try {
          const nextUrl = new URL(href, parsedUrl.toString()).toString();
          if (new URL(nextUrl).hostname === ALLOWED_HOST) memberUrls.push(nextUrl);
        } catch {
          // 無効なURLは無視
        }
      });

      return { teamName, players: uniquePlayers, memberUrls: [...new Set(memberUrls)] };
    };

    const firstHtml = await fetchHtml(parsedUrl.toString());
    const firstPage = parsePage(firstHtml);
    let teamName = firstPage.teamName;
    let players = firstPage.players;

    if (players.length === 0) {
      for (const memberUrl of firstPage.memberUrls.slice(0, 5)) {
        const memberPage = parsePage(await fetchHtml(memberUrl));
        teamName ||= memberPage.teamName;
        if (memberPage.players.length > 0) {
          players = memberPage.players;
          break;
        }
      }
    }

    if (players.length === 0) {
      return sendJson(res, 422, {
        success: false,
        message:
          "選手一覧を取得できませんでした。大会の『出場メンバー』ページURLを入力して再度お試しください。",
      });
    }

    return sendJson(res, 200, { success: true, teamName, players });
  } catch (error) {
    console.error("import-omyutech error", error);
    return sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "取込処理に失敗しました",
    });
  }
}
