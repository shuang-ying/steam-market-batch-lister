local logger = require("logger")
local millennium = require("millennium")
local ok_http, http = pcall(require, "http")

---@ffi
--- Fetch a public HTTPS URL from Lua backend (bypasses Steam page CSP/CORS for daily FX rates)
---@param url string
---@return string
function http_get_text(url)
    if not ok_http or type(http) ~= "table" or type(http.get) ~= "function" then
        return ""
    end
    if type(url) ~= "string" or not url:match("^https://") then
        return ""
    end
    local ok_call, res, err = pcall(http.get, url, { timeout = 10, follow_redirects = true })
    if not ok_call then
        logger:warn("http_get_text pcall error: " .. tostring(res))
        return ""
    end
    if not res or type(res) ~= "table" then
        logger:warn("http_get_text failed: " .. tostring(err))
        return ""
    end
    if res.status == 200 and type(res.body) == "string" then
        return res.body
    end
    logger:warn("http_get_text status " .. tostring(res.status) .. " for " .. url)
    return ""
end

---@ffi
--- Return persisted plugin settings as JSON string
---@return string
function get_settings_json()
    local raw, err = millennium.config.get("settings")
    if err ~= nil then
        logger:warn("Failed to read settings from millennium.config: " .. tostring(err))
        return "{}"
    end
    if type(raw) == "string" and #raw > 0 then
        return raw
    end
    return "{}"
end

---@ffi
--- Save plugin settings JSON string into Millennium persistent config
---@param settings_json string
---@return boolean
function save_settings_json(settings_json)
    if type(settings_json) ~= "string" or #settings_json == 0 then
        logger:error("Invalid settings JSON")
        return false
    end
    local ok, set_err = millennium.config.set("settings", settings_json)
    if not ok then
        logger:error("Failed to persist settings: " .. tostring(set_err))
        return false
    end
    logger:info("Saved batch lister settings")
    return true
end

---@ffi
--- Return Millennium runtime metadata for UI diagnostics
---@return string
function get_plugin_info()
    local ver = tostring(millennium.version() or "unknown"):gsub('"', '\\"')
    return string.format(
        '{"name":"Steam Market Batch Lister","version":"1.1.0","millenniumVersion":"%s"}',
        ver
    )
end

local function on_load()
    logger:info("Steam Market Batch Lister loaded on Millennium v" .. tostring(millennium.version()))
    millennium.ready()
end

local function on_unload()
    logger:info("Steam Market Batch Lister unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
