local logger = require("logger")
local millennium = require("millennium")
local ok_http, http = pcall(require, "http")
local ok_fs, fs = pcall(require, "fs")

local function resolve_history_path()
    local base = nil
    local ok_inst, inst = pcall(millennium.get_install_path)
    if ok_inst and type(inst) == "string" and #inst > 0 then
        base = inst
    else
        local ok_steam, sp = pcall(millennium.steam_path)
        if ok_steam and type(sp) == "string" and #sp > 0 then
            base = sp .. "\\millennium"
        end
    end
    if not base then
        return nil
    end
    local config_dir = base .. "\\config"
    if ok_fs and type(fs) == "table" and type(fs.create_directories) == "function" then
        pcall(fs.create_directories, config_dir)
    end
    return config_dir .. "\\smbl_listing_history.json"
end

---@ffi
--- Return local disk path used to store listing history
---@return string
function get_history_file_path()
    return resolve_history_path() or ""
end

---@ffi
--- Read persisted listing history JSON array from local disk (fallback to millennium.config)
---@return string
function load_history_json()
    local path = resolve_history_path()
    if path then
        local f = io.open(path, "rb")
        if f then
            local content = f:read("*a")
            f:close()
            if type(content) == "string" and #content > 0 then
                return content
            end
        end
    end
    local raw, err = millennium.config.get("listing_history")
    if err == nil and type(raw) == "string" and #raw > 0 then
        return raw
    end
    return "[]"
end

---@ffi
--- Persist listing history JSON array to local disk (fallback to millennium.config)
---@param history_json string
---@return boolean
function save_history_json(history_json)
    if type(history_json) ~= "string" or #history_json == 0 then
        return false
    end
    local path = resolve_history_path()
    if path then
        local f, err = io.open(path, "wb")
        if f then
            f:write(history_json)
            f:close()
            return true
        else
            logger:warn("Failed to write history file (" .. path .. "): " .. tostring(err))
        end
    end
    local ok, set_err = millennium.config.set("listing_history", history_json)
    if not ok then
        logger:error("Failed to save listing_history in millennium.config: " .. tostring(set_err))
        return false
    end
    return true
end

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
        '{"name":"Steam Market Batch Lister","version":"1.2.0","millenniumVersion":"%s"}',
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
