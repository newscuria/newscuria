'use strict';

var appname = "readability";
var log = require('_/util/logging.js')(appname);

var util = require('util');
var readability_api = require('_/util/readability-api.js');

var queue = require('./util/queue.js');
var topics = queue.topics;

var datastore_api = require('_/util/datastore-api.js');

//==BEGIN here
// connect to the message queue
queue.connect(function onQueueConnect(err) {
  if(err) {
    log.fatal({
      err: err,
    }, "Cannot connect to message queue!");

  } else {
    
    start();

  }//if-else
});
//==BEGIN here

function start()    {
  listen_to_urls_approved();
}//start()


function listen_to_urls_approved()  {
  var topic = topics.URLS_APPROVED;
  var channel = "readability";

  queue.read_message(topic, channel, function onReadMessage(err, message) {
    if(err) {
      log.error("Error geting message from queue!");
    } else {
      process_url_approved_message(message);
    }//if-else
  });
}//listen_to_urls_approved


function process_url_approved_message(msg)	{
	var RateLimiter = require('limiter').RateLimiter;

	// 'second', 'minute', 'day', or a number of milliseconds
	var limiter = new RateLimiter(30, 'minute'); // approx. 50K requests/day

	// Throttle requests: https://github.com/jhurliman/node-rate-limiter
	// The default behaviour is to wait for the duration of the rate limiting
	// that’s currently in effect before the callback is fired
	limiter.removeTokens(1, function onLimiter(err, remainingRequests) {
		// - err will only be set if we request more than the maximum number of
		// requests we set in the constructor
		// - remainingRequests tells us how many additional requests could be sent
		// right this moment

		if (err)	{

			log.info({
        remainingRequests: remainingRequests
      }, "Throttling APPROVED URLs message processing.");

		} else {

      var url = msg.url || '';

      get_readability(url);

    }//if-else
	});

}//process_url_approved_message()


function get_readability(url)	{
	var query_stmt = "SELECT * FROM nuzli.readability WHERE url=?";
  var params = [url];

  // CALLBACK
  var datastore_fetch_callback = function onDatastoreFetch(err, response)  {
    if(err) {
      log.error({err: err});

      fetch_readability_content(url, api_fetch_callback);

    } else if(response.rows.length > 0){
      // FIXME: TODO: what to do if > 1 rows?
      var buf = response.rows[0].api_result;
      var readability = JSON.parse(buf.toString('utf8'));

      // publish text if it isn't empty
      if((readability) && (readability.plaintext))  {
        queue.publish_message(topics.READABILITY, readability);

      } else if(!readability.plaintext) {
        log.error({
          readability: readability
        }, "EMPTY Readability PLAINTEXT.");

      } else if(!readability) {
        log.info({
          readability: readability
        }, "EMPTY Readability object... re-fetching from remote Readability API");
        
        fetch_readability_content(url, api_fetch_callback);
      }//if-else

    } else {
      log.info({
        url: url
      }, "URL not in datastore... fetching from remote Readability API");

      fetch_readability_content(url, api_fetch_callback);

    }//if-else
  };


  // CALLBACK
  var api_fetch_callback = function onReadabilityAPIFetch(err, readability) {
    if(err) {
      log.error({ err: err });

    } else {

      queue.publish_message(topics.READABILITY, readability);

    }//if-else
  };//api_fetch_callback

  log.info({
    url: url
  }, "FETCHING Readability from datastore.");

  try {
    datastore_api.client.execute(query_stmt, params, datastore_fetch_callback);

  } catch(err)  {
    log.error({
      err: err
    }, "Error fetching URL from the datastore... fetching from remote Readability API");

    fetch_readability_content(url, api_fetch_callback);
  }//try-catch

}//get_readability


function fetch_readability_content(url, callback)	{
  try {
  	readability_api.scrape(url, callback);
  } catch(err)  {
    log.error({err: err});
  }//try-catch
}//fetch_readability_content()
