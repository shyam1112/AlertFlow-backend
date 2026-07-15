import { graphqlShopifyCall } from "../../common/common";
import logger from "../../common/logger";
import orderModel from "../orders/orderModel";

// approve order fulfillment request
export const approveFulfillmentRequest = async (req, res) => {
    try {
      const { orderId, message = "" } = req.body;
  
      if (!orderId) {
        return res.status(400).json({ error: 'Missing orderId in request body' });
      }
  
      const fullGid = `gid://shopify/Order/${orderId}`;
      const orderFulfillmentId = await getOrderFulfillmentId(fullGid);
  
      if (!orderFulfillmentId) {
        const msg = `No fulfillmentOrder ID found for orderId: ${orderId}`;
        logger.error(msg);
        return res.status(404).json({ error: msg });
      }
  
      const query = `mutation fulfillmentOrderAcceptFulfillmentRequest($id: ID!, $message: String) {
        fulfillmentOrderAcceptFulfillmentRequest(id: $id, message: $message) {
          fulfillmentOrder {
            id
            status
            requestStatus
          }
          userErrors {
            field
            message
          }
        }
      }`;
  
      const variables = {
        id: orderFulfillmentId,
        message: message
      };
  
      const response = await graphqlShopifyCall(query, variables, `approveFulfillmentRequest - orderId : ${orderId}`);
  
      if (!response || !response.fulfillmentOrderAcceptFulfillmentRequest) {
        const msg = `Empty or invalid response from fulfillmentOrderAcceptFulfillmentRequest for orderId: ${orderId}`;
        logger.error(msg);
        return res.status(500).json({ error: msg });
      }
  
      const { userErrors, fulfillmentOrder } = response.fulfillmentOrderAcceptFulfillmentRequest;
  
      if (userErrors && userErrors.length > 0) {
        logger.error(`approveFulfillmentRequest - userError`, {
          orderId,
          userErrors
        });
        return res.status(400).json({ error: 'User errors from Shopify', details: userErrors });
      }
  
      return res.status(200).json({
        success: true,
        message: 'Fulfillment request approved successfully',
        fulfillmentOrder
      });
  
    } catch (error) {
      logger.error(`approveFulfillmentRequest: ${error.message}`, {
        shopName: req.get('X-Shopify-Shop-Domain'),
        payload: req.body,
        headers: req.headers,
        stack: error.stack,
      });
  
      return res.status(500).json({
        success: false,
        error: error.message,
        message: 'Internal Server Error',
      });
    }
  };
  

// reject order fulfillment request
export const rejectFulfillmentRequest = async (req, res) => {
  try {
    const { orderId, message = "" } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId in request body' });
    }

    const fullGid = `gid://shopify/Order/${orderId}`;
    const orderFulfillmentId = await getOrderFulfillmentId(fullGid);

    if (!orderFulfillmentId) {
      const msg = `No fulfillmentOrder ID found for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(404).json({ error: msg });
    }

    const query = `mutation fulfillmentOrderRejectFulfillmentRequest($id: ID!, $message: String) {
      fulfillmentOrderRejectFulfillmentRequest(id: $id, message: $message) {
        fulfillmentOrder {
          id
          status
          requestStatus
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const variables = {
      id: orderFulfillmentId,
      message: message
    };

    const response = await graphqlShopifyCall(query, variables, `rejectFulfillmentRequest - orderId : ${orderId}`);

    if (!response || !response.fulfillmentOrderRejectFulfillmentRequest) {
      const msg = `Empty or invalid response from fulfillmentOrderRejectFulfillmentRequest for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(500).json({ error: msg });
    }

    const { userErrors, fulfillmentOrder } = response.fulfillmentOrderRejectFulfillmentRequest;

    if (userErrors && userErrors.length > 0) {
      logger.error(`rejectFulfillmentRequest - userError`, {
        orderId,
        userErrors
      });
      return res.status(400).json({ error: 'User errors from Shopify', details: userErrors });
    }

    return res.status(200).json({
      success: true,
      message: 'Fulfillment request rejected successfully',
      fulfillmentOrder
    });

  } catch (error) {
    logger.error(`rejectFulfillmentRequest: ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      payload: req.body,
      headers: req.headers,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal Server Error',
    });
  }
};


// reject order fulfillment request
export const holdFulfillmentRequest = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId in request body' });
    }

    const fullGid = `gid://shopify/Order/${orderId}`;
    const orderFulfillmentId = await getOrderFulfillmentId(fullGid);

    if (!orderFulfillmentId) {
      const msg = `No fulfillmentOrder ID found for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(404).json({ error: msg });
    }

    const query = `
      mutation FulfillmentOrderHold($fulfillmentHold: FulfillmentOrderHoldInput!, $id: ID!) {
  fulfillmentOrderHold(fulfillmentHold: $fulfillmentHold, id: $id) {
    fulfillmentOrder {
      id
    }
    remainingFulfillmentOrder {
      id
    }
    userErrors {
      field
      message
    }
  }
}
    `;

    const variables = {
      fulfillmentHold: {
        reason: "OTHER", // or "HIGH_RISK_OF_FRAUD", "ADDRESS_VERIFICATION_FAILURE"
        reasonNotes: "Hold placed on fulfillment request - MLVeda"
      },
      id: orderFulfillmentId
    };

    const response = await graphqlShopifyCall(query, variables, `holdFulfillmentRequest - orderId : ${orderId}`);

    if (!response || !response.fulfillmentOrderHold) {
      const msg = `Empty or invalid response from fulfillmentOrderHold for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(500).json({ error: msg });
    }

    const { userErrors, fulfillmentOrder } = response.fulfillmentOrderHold;

    if (userErrors && userErrors.length > 0) {
      logger.error(`holdFulfillmentRequest - userError`, {
        orderId,
        userErrors
      });
      return res.status(400).json({ error: 'User errors from Shopify', details: userErrors });
    }

    return res.status(200).json({
      success: true,
      message: 'Fulfillment request placed on hold successfully',
      fulfillmentOrder
    });

  } catch (error) {
    logger.error(`holdFulfillmentRequest: ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      payload: req.body,
      headers: req.headers,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal Server Error',
    });
  }
};


// reject order fulfillment request
export const holdReleaseFulfillmentRequest = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId in request body' });
    }

    const fullGid = `gid://shopify/Order/${orderId}`;
    const orderFulfillmentId = await getOrderFulfillmentId(fullGid);

    if (!orderFulfillmentId) {
      const msg = `No fulfillmentOrder ID found for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(404).json({ error: msg });
    }

    const query = `
      mutation fulfillmentOrderReleaseHold($id: ID!) {
        fulfillmentOrderReleaseHold(id: $id) {
          fulfillmentOrder {
            id
            status
            requestStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: orderFulfillmentId,
    };

    const response = await graphqlShopifyCall(query, variables, `holdReleaseFulfillmentRequest - orderId : ${orderId}`);

    if (!response || !response.fulfillmentOrderReleaseHold) {
      const msg = `Empty or invalid response from fulfillmentOrderReleaseHold for orderId: ${orderId}`;
      logger.error(msg);
      return res.status(500).json({ error: msg });
    }

    const { userErrors, fulfillmentOrder } = response.fulfillmentOrderReleaseHold;

    if (userErrors && userErrors.length > 0) {
      logger.error(`holdReleaseFulfillmentRequest - userError`, {
        orderId,
        userErrors
      });
      return res.status(400).json({ error: 'User errors from Shopify', details: userErrors });
    }

    return res.status(200).json({
      success: true,
      message: 'Fulfillment hold released successfully',
      fulfillmentOrder
    });

  } catch (error) {
    logger.error(`holdReleaseFulfillmentRequest: ${error.message}`, {
      shopName: req.get('X-Shopify-Shop-Domain'),
      payload: req.body,
      headers: req.headers,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal Server Error',
    });
  }
};

// get orfer fulfillmet id  by order id
export const getOrderFulfillmentId = async (orderId, isOrderStoreInDb = true) =>{
    try{
      const query = `query{
        order(id:"${orderId}"){
          fulfillmentOrders(first:50, reverse: true){
            edges{
              node{
                id
                orderName
              }
            }
          }
        }
      }`
      const response = await graphqlShopifyCall(query, {}, `getOrderFulfillmentId - orderId : ${orderId}`);
  
      console.log("getOrderFulfillmentId - response?.order?.fulfillmentOrders : ",response?.order?.fulfillmentOrders);
      const fulfillmentOrderId = response?.order?.fulfillmentOrders?.edges[0]?.node?.id;
      if(response?.order?.fulfillmentOrders?.edges[0]?.node?.orderName && fulfillmentOrderId){
        await addOrderToDb(
          {
            orderNumber: response?.order?.fulfillmentOrders?.edges[0]?.node?.orderName, 
            orderId: orderId,
            fulfillmentId: fulfillmentOrderId
          }
        )
      }
      console.log(fulfillmentOrderId);
      return fulfillmentOrderId;
    }catch(error){
      console.error(`getOrderFulfillmentId: ${error.message}`)
      logger.error(`getOrderFulfillmentId: ${error.message}`, {
        orderId: orderId
      });
      return;
    }
  } 

  // add shopify order number and id to db for the scheduler tracking info
export const addOrderToDb = async ({orderNumber, orderId, fulfillmentId}) => {
  try{
    const order = await orderModel.findOne({shopifyOrderNumber: orderNumber})
    if(order){
      console.log(`order already exists in db: ${orderNumber}`)
      return;
    }
    const newOrder = await orderModel.create({
      shopifyOrderNumber: orderNumber,
      shopifyOrderId: orderId,
      shopifyFulfillmentId: fulfillmentId
    })
    console.log(`new order added to db: ${orderNumber}`);
    return;
  }catch(error){
    console.error(`addOrderToDb: ${error.message}`)
    logger.error(`addOrderToDb: ${error.message}`, {
      orderNumber,
      orderId,
      fulfillmentId,
      stack: error.stack
    });
    return;
  }
}

// cancel fulfillment request 
export const cancelFulfillmentRequest = async (req, res) => {
  try {
    const { orderId, message = "" } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: "orderId is required" });
    }

    // 1. Get Fulfillment Order ID
    const OrderFulfillmentId = await getOrderFulfillmentId(`gid://shopify/Order/${orderId}`, false);

    console.log("OrderFulfillmentId (Cancel): ", OrderFulfillmentId);

    if (!OrderFulfillmentId) {
      const msg = `No fulfillment order found for orderId: ${orderId}`;
      console.error(`cancelFulfillmentRequest - ${msg}`);
      return res.status(404).json({ success: false, error: msg });
    }

    // 2. GraphQL Mutation
    const query = `
      mutation fulfillmentOrderRejectFulfillmentRequest($id: ID!, $message: String) {
        fulfillmentOrderRejectFulfillmentRequest(id: $id, message: $message) {
          fulfillmentOrder {
            id
            status
            requestStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = { id: OrderFulfillmentId, message };

    // 3. Call Shopify
    const response = await graphqlShopifyCall(
      query,
      variables,
      `cancelFulfillmentRequest - orderId: ${orderId}`
    );

    const result = response?.fulfillmentOrderRejectFulfillmentRequest;

    // 4. Handle Shopify Errors
    if (result?.userErrors?.length > 0) {
      console.error("cancelFulfillmentRequest - userErrors:", result.userErrors);
      logger.error("cancelFulfillmentRequest - userErrors", result.userErrors);
      return res.status(400).json({
        success: false,
        error: "Shopify user errors",
        details: result.userErrors,
      });
    }

    console.log("cancelFulfillmentRequest - response:", result);

    return res.status(200).json({
      success: true,
      data: result.fulfillmentOrder,
    });

  } catch (error) {
    console.error("cancelFulfillmentRequest error:", error.message);
    logger.error("cancelFulfillmentRequest error", {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
};
