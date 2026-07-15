import axios from 'axios';
import logger from './logger';
/**
 * Executes a Shopify GraphQL API call
 * 
 * @param {string} query - The GraphQL query string
 * @param {object} variables - Variables used in the query
 * @param {string} message - Optional label for logging context
 * @returns {Promise<object|null>} - The response data or null on error
 */
export const graphqlShopifyCall = async (query, variables = {}, message = '') => {
  try {
    const response = await axios.post(
      `https://${process.env.STORE_URL}/admin/api/2025-04/graphql.json`,
      { query, variables },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.STORE_TOKEN,
          'Content-Type': 'application/json',
        },
        maxBodyLength: Infinity,
      }
    );

    // Handle GraphQL errors
    if (response?.data?.errors) {
      logger.error(`${message} - GraphQL Error:`, {
        errors: response.data.errors,
        query,
        variables,
      });
      console.error(`${message} - GraphQL Error:`, JSON.stringify(response.data.errors));
      return null;
    }
    console.log("Response graphql : ",response.data);
    return response?.data?.data;
  } catch (axiosError) {
    // Axios structured error handling
    if (axiosError.response) {
      logger.error(`${message} - Axios Response Error:`, {
        status: axiosError.response.status,
        data: axiosError.response.data,
      });
      console.error(`${message} - Axios Response Error:`, axiosError.response.data);
    } else if (axiosError.request) {
      logger.error(`${message} - Axios Request Error:`, {
        request: axiosError.request,
      });
      console.error(`${message} - Axios Request Error:`, axiosError.request);
    } else {
      logger.error(`${message} - Axios Unexpected Error:`, {
        message: axiosError.message,
        stack: axiosError.stack,
      });
      console.error(`${message} - Axios Unexpected Error:`, axiosError.message);
    }

    return null;
  }
};
