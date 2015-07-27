'use strict';

var fs = require('fs');
var url = require('url');
var path = require('path');

var Qs = require('qs');
var async = require('async');
var ranger = require('number-ranger');
var request = require('request');
var cheerio = require('cheerio');

var crawler = {};

var chapterRegExp = /Ch.(\d+(\.\d+)?)/;
function listChaptersFromHtml(html, job, config) {
    var $ = cheerio.load(html);

    var language = (config.batoto && config.batoto.language || 'english').toLowerCase();

    var chapters = $('.chapter_row')
        .filter(function(i, e) {
            return $(e)
                .attr('class')
                .toLowerCase()
                .split(' ')
                .indexOf('lang_' + language) !== -1;
        })
        .map(function(i, e) {
            var chapterMatch = chapterRegExp.exec($(e).text());
            if (!chapterMatch) {
                return null;
            }
            var chapter = parseFloat(chapterMatch[1]);
            return {
                series: job.series,
                chapter: chapter,
                url: $($(e).find('a')[0]).attr('href')
            };
        })
        .filter(function(i, e) { // Remove null values
            return e;
        })
        .get()
        .filter(ranger.isInRangeFilter(job.chapters, 'chapter'))
        .sort(function(a, b) {
            return parseFloat(a.chapter) - parseFloat(b.chapter);
        });

    return chapters;
}

function getSeriesUrlFromSearch(name, cb) {
    var baseUrl = 'http://bato.to';
    name = name.toLowerCase();
    var params = {
        name: name
    };
    var url = baseUrl + '/search?' + Qs.stringify(params);
    request.get(url, function(error, response, html) {
        if (error) {
            return cb(error);
        }
        var $ = cheerio.load(html);
        var seriesList = $('#comic_search_results .chapters_list a')
            .filter(function(i, elt) {
                var text = $(elt).text().trim().toLowerCase();
                return text === name;
            })
            .get();
        return cb(null, $(seriesList[0]).attr('href'));
    });
}

crawler.listJobs = function(job, config, cb) {
    getSeriesUrlFromSearch(job.series, function(error, url) {
        if (error) {
            return cb(error);
        }
        request.get(url, function(error, response, html) {
            if (error) {
                return cb(error);
            }
            return cb(null, listChaptersFromHtml(html, job, config));
        });
    });
};

function getImageUrl(html) {
    var $ = cheerio.load(html);
    return $('#comic_page').attr('src');
}

function downloadImageOnPage(downloadJob, page, cb) {
    request.get(page.url, function(error, response, html) {
        if (error) {
            return cb(error);
        }
        var imageUrl = getImageUrl(html),
            imageFileName = path.basename(
                url.parse(imageUrl).pathname
            ),
            outputFile = path.resolve(
                downloadJob.dest,
                page.number + path.extname(imageFileName)
            );
        request.get(imageUrl)
            .pipe(fs.createWriteStream(outputFile))
            .on('error', cb)
            .on('finish', cb);
    });
}

function listPagesFromHtml(html) {
    var $ = cheerio.load(html);
    return $('#page_select')
        .first()
        .find('select option')
        .map(function(i, e) {
            return {
                number: $(e).text(),
                url: $(e).val()
            };
        })
        .get();
}

crawler.downloadChapter = function(downloadJob, config, cb) {
    request.get(downloadJob.url, function(error, response, html) {
        if (error) {
            return cb(error);
        }
        var pages = listPagesFromHtml(html);
        async.eachLimit(pages, config.pageConcurrency, function(page, cb) {
            downloadImageOnPage(downloadJob, page, cb);
        }, cb);
    });
};

module.exports = crawler;
