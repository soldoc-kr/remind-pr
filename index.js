// request-pr-review
// Copyright (c) 2024-present NAVER Corp.
// Apache-2.0

const core = require("@actions/core");
const axios = require("axios");

const D0 = "D-0";
const ENCODE_PAIR = {
    "<": "&lt;",
    ">": "&gt;"
};
const encodeText = text => text.replace(/[<>]/g, matched => ENCODE_PAIR[matched]);
const authFetch = url => axios({
    method: "get",
    headers: {
        Authorization: `token ${core.getInput("token")}`
    },
    url
}).then(res => res.data);
const createRequestPRData = (channel) => {
    if (channel.requestedPRs.length === 0) {
        return null;  // PR이 없으면 메시지 자체를 생성하지 않음
    }

    const prText = channel.requestedPRs
        .map(({ title, url, labels }) => {
            let text = `• <${url}|${encodeText(title)}>`;
            if (labels.some(({ name }) => name === D0)) {
                text += `\n\t• ☝️PR은 \`${D0}\` PR로 매우 긴급한 PR입니다. 🚨 지금 바로 리뷰에 참여해 주세요.`;
            }
            return text;
        })
        .join("\n");

    return {
        text: "좋은 아침이에요 :wave:",
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "👋 좋은 아침입니다"
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `🙏 @here 리뷰를 애타게 기다리는 동료의 PR이 있어요. 리뷰에 참여해 주세요:`
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: prText
                }
            }
        ]
    };
};
/**
 * @param {object} data
 */
const sendSlack = (data) => axios({
    method: "post",
    headers: {
        Authorization: `Bearer ${core.getInput("slackBotToken")}`,
        "Content-Type": "application/json"
    },
    url: "https://slack.com/api/chat.postMessage",
    data: {
        channel: `${core.getInput("slackChannel")}`,
        ...data
    }
});

class Pull {
    /**
     * @type {{[key: string]: Pull}}
     * @private
     */
    static _instances = {};

    /**
     * @param {{title: string, html_url: string, number: number, labels: {name: string}[]}} pullInfo
     * @returns {Pull}
     */
    static create(pullInfo) {
        const {html_url: url} = pullInfo;

        return Pull._instances[url] || (Pull._instances[url] = new Pull(pullInfo));
    }

    /**
     * @param {{title: string, html_url: string, number: number, labels: {name: string}[]}} pullInfo
     * @returns {Pull}
     */
    constructor(pullInfo) {
        const {title, html_url, number, labels} = pullInfo;

        this._title = title;
        this._url = html_url;
        this._number = number;
        this._labels = labels;
    }

    get title() {
        return this._title;
    }

    get url() {
        return this._url;
    }

    get number() {
        return this._number;
    }

    get labels() {
        return this._labels;
    }
}

class Channel {

    constructor() {
        /**
         * @type {Pull[]}
         * @private
         */
        this._requestedPRs = [];
    }
    get requestedPRs() {
        return this._requestedPRs;
    }

    /**
     * @param {Pull} pull
     */
    requestReview(pull) {
        this._requestedPRs.push(pull);
    }
}

const refineToApiUrl = repoUrl => {
    const enterprise = !repoUrl.includes("github.com");
    const [host, pathname] = repoUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split(/\/(.*)/); // github.com/abc/def -> ['github.com', 'abc/def', '']

    if (enterprise) {
        return `https://${host}/api/v3/repos/${pathname}`;
    }

    return `https://api.${host}/repos/${pathname}`;
};

(async () => {
    try {
        const BASE_API_URL = refineToApiUrl(core.getInput("repoUrl"));
        const channel = new Channel();

        core.info(`Running for: ${BASE_API_URL}`);

        const fetchPulls = () => authFetch(`${BASE_API_URL}/pulls`);

        core.info("Fetching pulls...");

        for (const pullInfo of await fetchPulls()) {
            const pull = Pull.create(pullInfo);   
            core.info(`Fetching reviewers of #${pull.number}...`);
            if(pull.labels.some(({name}) => 
                name.toLowerCase().includes("feature") || 
                name.toLowerCase().includes("bug"))) {
                channel.requestReview(pull);
            }
        }
        
        
        const messageData = createRequestPRData(channel);

        if (messageData) {
            core.info("Starting sending messages...");
            const slackResponse = await sendSlack(messageData);
            core.info(`Slack API response: ${JSON.stringify(slackResponse.data)}`);

            if (!slackResponse.data.ok) {
                core.setFailed(`Slack API error: ${slackResponse.data.error}`);
            } else {
                core.info("Slack message sent successfully");
            }
        } else {
            core.info("대기 중인 PR이 없어서 슬랙 메시지를 보내지 않았습니다.");
        }


    } catch (e) {
        core.setFailed(e.message);
    }
})();
